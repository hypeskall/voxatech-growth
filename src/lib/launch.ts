import { z } from "zod";

const placeholderDomains = new Set([
  "example.com",
  "example.org",
  "example.net",
  "website.com",
  "test.com",
  "invalid",
  "localhost",
]);

export const launchConfirmation = "CONFIRM LANSAREA";
export const optOutLine =
  "Dacă nu este relevant, îmi puteți spune și nu vă mai contactez.";

export function validProspectEmail(value: string | null | undefined) {
  if (!value || !z.email().safeParse(value.trim().toLowerCase()).success)
    return false;
  const [local, domain] = value.trim().toLowerCase().split("@");
  return (
    !!local &&
    !!domain &&
    !placeholderDomains.has(domain) &&
    !/\.(invalid|test|example|localhost)$/i.test(domain) &&
    !/(example|placeholder|invalid|website|noreply|no-reply|donotreply)/iu.test(
      `${local}@${domain}`,
    )
  );
}

export function hasIdentityAndOptOut(body: string) {
  return (
    (/VoxaTech/u.test(body) ||
      (/\bVoxa\b/u.test(body) && /voxatech\.ro/u.test(body))) &&
    /(nu (?:vă|te) mai contactez|nu mai revenim|dezabon|opr(?:im|iți) mesajele)/iu.test(
      body,
    )
  );
}

export type LaunchReadinessInput = {
  senderVerified: boolean;
  recipients: Array<{ email: string | null }>;
  drafts: Array<{ approved: boolean; body: string }>;
  dailyCap: number;
  confirmation?: string;
  liveMode: boolean;
};

export function evaluateLaunchReadiness(input: LaunchReadinessInput) {
  const recipientsValid =
    input.recipients.length > 0 &&
    input.recipients.every((recipient) => validProspectEmail(recipient.email));
  const draftsApproved =
    input.drafts.length === input.recipients.length &&
    input.drafts.every((draft) => draft.approved);
  const compliantCopy =
    input.drafts.length === input.recipients.length &&
    input.drafts.every((draft) => hasIdentityAndOptOut(draft.body));
  const dailyLimitValid = input.dailyCap > 0 && input.dailyCap <= 10;
  const manuallyConfirmed = input.confirmation === launchConfirmation;
  return {
    senderVerified: input.senderVerified,
    recipientsValid,
    draftsApproved,
    compliantCopy,
    dailyLimitValid,
    manuallyConfirmed,
    liveMode: input.liveMode,
    ready:
      input.senderVerified &&
      recipientsValid &&
      draftsApproved &&
      compliantCopy &&
      dailyLimitValid &&
      manuallyConfirmed &&
      input.liveMode,
  };
}
