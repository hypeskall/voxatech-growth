import "server-only";
import { admin, check, enqueue } from "./db";
import { gmailAccessToken } from "./providers/gmail";
import {
  gmailApi,
  gmailAddress,
  gmailBody,
  gmailHeader,
  gmailSubject,
  gmailAttachments,
  type GmailMessage,
} from "./gmail-api";

export async function syncGmail(org?: string) {
  let query = admin()
    .from("gmail_accounts")
    .select("*")
    .in("status", ["connected", "paused"])
    .order("last_synced_at", { nullsFirst: true });
  if (org) query = query.eq("organization_id", org);
  const accounts = check(await query.limit(30));
  const results: { email: string; imported: number; ok: boolean }[] = [];
  const started = Date.now();
  for (const account of accounts) {
    if (Date.now() - started > 45000) break;
    let imported = 0;
    try {
      const token = await gmailAccessToken(account, true);
      const threads = check(
        await admin()
          .from("gmail_threads")
          .select("*")
          .eq("organization_id", account.organization_id)
          .eq("account_id", account.id)
          .order("last_synced_at", { nullsFirst: true })
          .limit(30),
      );
      for (const thread of threads) {
        if (Date.now() - started > 45000) break;
        const remote = await gmailApi<{ messages?: GmailMessage[] }>(
          token,
          `threads/${encodeURIComponent(thread.thread_id)}?format=full`,
        );
        const parent = check(
          await admin()
            .from("messages")
            .select("*")
            .eq("organization_id", account.organization_id)
            .eq("id", thread.parent_id)
            .single(),
        );
        const lead = check(
          await admin()
            .from("leads")
            .select("*")
            .eq("organization_id", account.organization_id)
            .eq("id", thread.lead_id)
            .single(),
        );
        for (const mail of remote.messages || []) {
          const from = gmailAddress(gmailHeader(mail, "from"));
          if (
            !from ||
            from === account.email ||
            mail.labelIds?.some((label) => ["SENT", "DRAFT"].includes(label))
          )
            continue;
          const key = `gmail-inbound:${account.id}:${mail.id}`;
          const existing = check(
            await admin()
              .from("messages")
              .select("id,metadata")
              .eq("organization_id", account.organization_id)
              .eq("idempotency_key", key)
              .maybeSingle(),
          );
          const existingMetadata =
            existing?.metadata &&
            typeof existing.metadata === "object" &&
            !Array.isArray(existing.metadata)
              ? existing.metadata
              : {};
          if (existingMetadata.gmail_sync_complete === true) continue;
          const mismatch = from !== lead.email?.trim().toLowerCase();
          const conv = check(
            await admin()
              .from("conversations")
              .upsert(
                {
                  organization_id: account.organization_id,
                  lead_id: lead.id,
                  channel: "email",
                },
                { onConflict: "organization_id,lead_id,channel" },
              )
              .select()
              .single(),
          );
          const body = gmailBody(mail);
          check(
            await admin()
              .from("messages")
              .upsert(
                {
                  organization_id: account.organization_id,
                  lead_id: lead.id,
                  campaign_id: parent.campaign_id,
                  conversation_id: conv.id,
                  direction: "inbound",
                  status: "received",
                  provider: "gmail",
                  provider_message_id: `${account.id}:${mail.id}`,
                  idempotency_key: key,
                  body,
                  subject: gmailSubject(mail),
                  received_at: new Date(
                    Number(mail.internalDate) || Date.now(),
                  ).toISOString(),
                  classification: mismatch ? "human_required" : null,
                  metadata: {
                    from_email: from,
                    to_email: account.email,
                    mailbox_email: account.email,
                    gmail_account_id: account.id,
                    gmail_thread_id: thread.thread_id,
                    rfc_message_id: gmailHeader(mail, "message-id"),
                    sender_mismatch: mismatch,
                    attachment_names: gmailAttachments(mail),
                  },
                },
                {
                  onConflict: "organization_id,idempotency_key",
                  ignoreDuplicates: true,
                },
              ),
          );
          const saved = check(
            await admin()
              .from("messages")
              .select("id,metadata,updated_at")
              .eq("organization_id", account.organization_id)
              .eq("idempotency_key", key)
              .single(),
          );
          // These operations are deliberately replayed even for a duplicate:
          // a previous sync may have crashed just after persisting the message.
          check(
            await admin()
              .from("campaign_leads")
              .update({
                stopped_at: new Date().toISOString(),
                stop_reason: "reply",
                next_action_at: null,
              })
              .eq("organization_id", account.organization_id)
              .eq("lead_id", lead.id)
              .is("stopped_at", null),
          );
          check(
            await admin()
              .from("messages")
              .update({ status: "cancelled" })
              .eq("organization_id", account.organization_id)
              .eq("lead_id", lead.id)
              .eq("direction", "outbound")
              .not("follow_up_number", "is", null)
              .in("status", ["draft", "approved", "queued"]),
          );
          if (!lead.do_not_contact) {
            if (mismatch)
              check(
                await admin()
                  .from("leads")
                  .update({ status: "HUMAN_REQUIRED", next_action_at: null })
                  .eq("organization_id", account.organization_id)
                  .eq("id", lead.id)
                  .not("status", "in", "(WON,LOST,DO_NOT_CONTACT)"),
              );
            else
              check(
                await admin()
                  .from("leads")
                  .update({ status: "REPLIED", next_action_at: null })
                  .eq("organization_id", account.organization_id)
                  .eq("id", lead.id)
                  .in("status", [
                    "NEW",
                    "ENRICHING",
                    "READY_FOR_OUTREACH",
                    "CONTACTED",
                    "FOLLOW_UP_1",
                    "FOLLOW_UP_2",
                  ]),
              );
          }
          if (!mismatch)
            await enqueue(
              account.organization_id,
              "process_inbound_replies",
              `inbound:${saved.id}`,
              lead.id,
              { message_id: saved.id },
            );
          // Mark complete only after stop/enqueue succeeds. A conditional update
          // preserves metadata changed concurrently by a reviewer or worker.
          const savedMetadata =
            saved.metadata &&
            typeof saved.metadata === "object" &&
            !Array.isArray(saved.metadata)
              ? saved.metadata
              : {};
          check(
            await admin()
              .from("messages")
              .update({
                metadata: { ...savedMetadata, gmail_sync_complete: true },
              })
              .eq("organization_id", account.organization_id)
              .eq("id", saved.id)
              .eq("updated_at", saved.updated_at),
          );
          if (!existing) imported++;
        }
        check(
          await admin()
            .from("gmail_threads")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("organization_id", account.organization_id)
            .eq("id", thread.id),
        );
      }
      check(
        await admin()
          .from("gmail_accounts")
          .update({
            last_synced_at: new Date().toISOString(),
          })
          .eq("organization_id", account.organization_id)
          .eq("id", account.id)
          .in("status", ["connected", "paused"]),
      );
      check(
        await admin()
          .from("gmail_accounts")
          .update({ last_error: null })
          .eq("organization_id", account.organization_id)
          .eq("id", account.id)
          .eq("status", "connected"),
      );
      results.push({ email: account.email, imported, ok: true });
    } catch {
      check(
        await admin()
          .from("gmail_accounts")
          .update({
            last_error:
              "Sincronizarea Gmail a eșuat. Verifică accesul Google; trimiterile așteaptă sincronizarea.",
          })
          .eq("organization_id", account.organization_id)
          .eq("id", account.id)
          .eq("status", "connected"),
      );
      results.push({ email: account.email, imported, ok: false });
    }
  }
  return results;
}
