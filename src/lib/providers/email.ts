import "server-only";
import { Resend } from "resend";
export interface EmailProvider {
  send(input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    key: string;
    unsubscribe: string;
    replyTo?: string;
  }): Promise<{ id: string | null; mode: "live" | "log" }>;
  sendInternalTest(input: {
    subject: string;
    text: string;
    key: string;
  }): Promise<{ id: string; mode: "internal-test" }>;
}
export class ResendProvider implements EmailProvider {
  async send(input: Parameters<EmailProvider["send"]>[0]) {
    if (process.env.EMAIL_DELIVERY_MODE !== "live")
      return { id: null, mode: "log" as const };
    if (!process.env.RESEND_API_KEY) throw new Error("Resend neconfigurat.");
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send(
      {
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: `${input.text}\n\nDezabonare: ${input.unsubscribe}`,
        replyTo: input.replyTo,
        headers: {
          "List-Unsubscribe": `<${input.unsubscribe}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      },
      { idempotencyKey: input.key },
    );
    if (result.error) throw new Error(`Resend: ${result.error.name}`);
    return { id: result.data!.id, mode: "live" as const };
  }

  async sendInternalTest(input: {
    subject: string;
    text: string;
    key: string;
  }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const to = process.env.INTERNAL_TEST_EMAIL;
    if (!apiKey || !from || !to)
      throw new Error(
        "Testul intern necesită RESEND_API_KEY, RESEND_FROM_EMAIL și INTERNAL_TEST_EMAIL.",
      );
    const result = await new Resend(apiKey).emails.send(
      {
        from,
        to,
        subject: `[TEST INTERN] ${input.subject}`,
        text: `Acesta este un test intern Voxa Growth. Nu a fost contactat niciun prospect.\n\n${input.text}`,
      },
      { idempotencyKey: input.key },
    );
    if (result.error) throw new Error(`Resend: ${result.error.name}`);
    return { id: result.data!.id, mode: "internal-test" as const };
  }
}
export const email: EmailProvider = new ResendProvider();

export async function verifyResendSenderDomain() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from)
    throw new Error("Configurează RESEND_API_KEY și RESEND_FROM_EMAIL.");
  const address = from.match(/<([^>]+)>/)?.[1] || from;
  const parsed = address.trim().toLowerCase().split("@");
  if (parsed.length !== 2 || !parsed[1])
    throw new Error("RESEND_FROM_EMAIL nu este o adresă validă.");
  const senderDomain = parsed[1];
  const result = await new Resend(apiKey).domains.list();
  if (result.error) throw new Error(`Resend: ${result.error.name}`);
  const domain = result.data?.data.find(
    (candidate) =>
      senderDomain === candidate.name.toLowerCase() ||
      senderDomain.endsWith(`.${candidate.name.toLowerCase()}`),
  );
  return {
    senderDomain,
    verified: domain?.status === "verified",
    providerDomainId: domain?.id || null,
    providerStatus: domain?.status || "missing",
  };
}
