import "server-only";
import { z } from "zod";
import { admin, check } from "../db";
import { gmailMime, openGmailSecret } from "../gmail-security";
import {
  gmailApi,
  googleToken,
  GmailApiError,
  GmailDeferredError,
  GmailStoppedError,
} from "../gmail-api";
import type { Row } from "../domain";

export async function gmailAccount(org: string, from: string) {
  return check(
    await admin()
      .from("gmail_accounts")
      .select("*")
      .eq("organization_id", org)
      .eq("email", from.trim().toLowerCase())
      .maybeSingle(),
  );
}
export async function gmailAccessToken(
  account: Row<"gmail_accounts">,
  reading = false,
) {
  if (
    !(
      account.status === "connected" ||
      (reading && account.status === "paused")
    ) ||
    !account.encrypted_refresh_token
  )
    throw new Error(`Reconectează căsuța Gmail ${account.email}.`);
  try {
    const token = await googleToken(
      new URLSearchParams({
        client_id: process.env.GOOGLE_GMAIL_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_GMAIL_CLIENT_SECRET || "",
        grant_type: "refresh_token",
        refresh_token: openGmailSecret(
          account.encrypted_refresh_token,
          `${account.organization_id}:${account.google_subject}`,
        ),
      }),
    );
    return token.access_token;
  } catch (error) {
    if (error instanceof GmailApiError && [400, 401].includes(error.status)) {
      check(
        await admin()
          .from("gmail_accounts")
          .update({
            status: "reconnect_required",
            last_error:
              "Accesul Google a expirat sau a fost revocat. Reconectează căsuța.",
          })
          .eq("organization_id", account.organization_id)
          .eq("id", account.id),
      );
    }
    throw new Error(
      `Accesul la Gmail ${account.email} nu poate fi reînnoit. Verifică conexiunea.`,
    );
  }
}

export async function sendGmail(
  account: Row<"gmail_accounts">,
  input: {
    to: string;
    subject: string;
    text: string;
    key: string;
    unsubscribe?: string;
    parentId?: string;
    leadId?: string;
    threadId?: string;
    inReplyTo?: string;
  },
) {
  const root = admin(),
    org = account.organization_id;
  const previous = check(
    await root
      .from("gmail_delivery_attempts")
      .select("*")
      .eq("organization_id", org)
      .eq("delivery_key", input.key)
      .maybeSingle(),
  );
  if (previous?.status === "sent" && previous.provider_message_id)
    return {
      id: previous.provider_message_id,
      mode: "live" as const,
      provider: "gmail" as const,
    };
  if (previous)
    throw new Error(
      "Trimitere Gmail incertă sau nereușită. Verifică mesajul în Gmail înainte de o nouă încercare.",
    );
  if (account.status !== "connected")
    throw new GmailDeferredError(
      "Căsuța Gmail așteaptă reconectarea sau reluarea.",
    );
  if (input.parentId && !account.last_test_at)
    throw new GmailDeferredError(
      "Trimite un test intern după reconectarea Gmail.",
    );
  if (
    input.parentId &&
    (!account.last_synced_at ||
      Date.now() - new Date(account.last_synced_at).getTime() > 15 * 60000)
  )
    throw new GmailDeferredError(
      "Sincronizarea răspunsurilor Gmail trebuie actualizată înainte de trimitere.",
    );
  if (input.leadId) {
    const threads = check(
      await root
        .from("gmail_threads")
        .select("last_synced_at")
        .eq("organization_id", org)
        .eq("account_id", account.id)
        .eq("lead_id", input.leadId),
    );
    if (
      threads.some(
        (thread) =>
          !thread.last_synced_at ||
          Date.now() - new Date(thread.last_synced_at).getTime() > 15 * 60000,
      )
    )
      throw new GmailDeferredError(
        "Actualizează conversația Gmail înainte de următoarea trimitere.",
      );
  }
  const raw = gmailMime({ ...input, from: account.email });
  let access: string;
  try {
    access = await gmailAccessToken(account);
  } catch {
    throw new GmailDeferredError("Căsuța Gmail așteaptă reconectarea.");
  }
  const claim = await root.rpc("claim_gmail_delivery", {
    org,
    mailbox: account.id,
    request_key: input.key,
  });
  if (claim.error?.message.includes("GMAIL_STOPPED:"))
    throw new GmailStoppedError(
      claim.error.message.replace("GMAIL_STOPPED: ", ""),
    );
  if (
    claim.error?.message.includes("GMAIL_DEFERRED:") ||
    claim.error?.message.includes("reconectare")
  )
    throw new GmailDeferredError(
      "Căsuța așteaptă următorul interval sau ziua următoare.",
    );
  if (!check(claim))
    throw new Error(
      "Acest mesaj Gmail este deja în curs de trimitere. Nu se repetă automat.",
    );
  let result: { id: string; threadId: string };
  try {
    result = z
      .object({ id: z.string().min(1), threadId: z.string().min(1) })
      .parse(
        await gmailApi(access, "messages/send", {
          method: "POST",
          body: JSON.stringify({
            raw,
            ...(input.threadId ? { threadId: input.threadId } : {}),
          }),
        }),
      );
  } catch (error) {
    const definitive =
      error instanceof GmailApiError &&
      error.status >= 400 &&
      error.status < 500;
    check(
      await root
        .from("gmail_delivery_attempts")
        .update({ status: definitive ? "failed" : "unknown" })
        .eq("organization_id", org)
        .eq("delivery_key", input.key),
    );
    // Stop this mailbox on provider rejection or an ambiguous delivery, rather
    // than continuing with the next prospect or retrying the same message.
    check(
      await root
        .from("gmail_accounts")
        .update({
          status:
            error instanceof GmailApiError && error.status === 401
              ? "reconnect_required"
              : "paused",
          last_error: definitive
            ? "Google a respins o trimitere. Verifică Gmail înainte de reluare."
            : "Livrare incertă. Verifică folderul Trimise înainte de reluare.",
        })
        .eq("organization_id", org)
        .eq("id", account.id),
    );
    throw new Error(
      "Gmail a fost pus în pauză. Verifică ultima trimitere înainte de reluare.",
    );
  }
  const providerId = `${account.id}:${result.id}`;
  // Save the thread before the receipt. If persistence fails, the durable
  // attempt stays 'sending' and cannot produce a second Gmail request.
  if (input.parentId && input.leadId)
    check(
      await root.from("gmail_threads").upsert(
        {
          organization_id: org,
          account_id: account.id,
          thread_id: result.threadId,
          lead_id: input.leadId,
          parent_id: input.parentId,
        },
        { onConflict: "organization_id,account_id,thread_id" },
      ),
    );
  check(
    await root
      .from("gmail_delivery_attempts")
      .update({ status: "sent", provider_message_id: providerId })
      .eq("organization_id", org)
      .eq("delivery_key", input.key),
  );
  return { id: providerId, mode: "live" as const, provider: "gmail" as const };
}
