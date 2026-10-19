import type { Snapshot } from "./snapshot";
type Message = Snapshot["messages"][number];
export function messageMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function isDeliveryNotification(
  message: Pick<Message, "direction" | "metadata">,
) {
  if (message.direction !== "inbound") return false;
  const meta = messageMetadata(message.metadata);
  const from = String(meta.from_email || "").trim();
  const address = (from.match(/<([^<>]+)>/)?.[1] || from).trim();
  return /^(?:mailer-daemon|postmaster)(?:\+[^@\s]+)?@[^@\s]+$/i.test(address);
}
export function isInboxReply(message: Pick<Message, "direction" | "metadata">) {
  return message.direction === "inbound" && !isDeliveryNotification(message);
}
export function messageMailbox(
  message: Message,
  campaigns: Snapshot["campaigns"],
) {
  const meta = messageMetadata(message.metadata);
  return String(
    meta.mailbox_email ||
      campaigns.find((campaign) => campaign.id === message.campaign_id)
        ?.sender_identity ||
      "",
  );
}
function messageTime(message: Message) {
  return (
    new Date(
      message.received_at || message.sent_at || message.created_at,
    ).getTime() || 0
  );
}
export function inboxConversations(
  data: Pick<Snapshot, "messages" | "leads" | "campaigns">,
  query = "",
  mailbox = "",
  attentionOnly = false,
  repliesOnly = false,
  hotOnly = false,
) {
  const grouped = new Map<string, Message[]>();
  for (const message of data.messages) {
    if (isDeliveryNotification(message)) continue;
    if (mailbox && messageMailbox(message, data.campaigns) !== mailbox)
      continue;
    const messages = grouped.get(message.lead_id) || [];
    messages.push(message);
    grouped.set(message.lead_id, messages);
  }
  const leadMap = new Map(data.leads.map((lead) => [lead.id, lead]));
  return [...grouped]
    .map(([id, messages]) => {
      messages.sort((a, b) => messageTime(a) - messageTime(b));
      const lead = leadMap.get(id);
      const received = messages
        .filter((message) => message.direction === "inbound")
        .at(-1);
      const latest = messages.at(-1)!;
      const answered =
        received &&
        messages.some(
          (message) =>
            message.in_reply_to === received.id &&
            ["sent", "delivered", "opened"].includes(message.status),
        );
      const attention =
        lead?.status === "HUMAN_REQUIRED" ||
        (!answered &&
          !!received &&
          (received.classification === "human_required" ||
            messageMetadata(received.metadata).sender_mismatch === true));
      const meta = messageMetadata(received?.metadata);
      const hot =
        !!received &&
        !lead?.do_not_contact &&
        meta.sender_mismatch !== true &&
        !["refusal", "unsubscribe", "not_interested", "wrong_contact"].includes(
          received.classification || "",
        ) &&
        ((meta.is_hot_lead === true &&
          Number(meta.classification_confidence) >= 0.85) ||
          (received.classification === "positive" &&
            Number(meta.classification_confidence) >= 0.85));
      return { id, lead, messages, received, latest, attention, hot };
    })
    .filter((conversation) => {
      const terms = [
        conversation.lead?.company_name,
        conversation.lead?.email,
        ...conversation.messages.map((message) =>
          String(messageMetadata(message.metadata).from_email || ""),
        ),
      ]
        .join(" ")
        .toLocaleLowerCase("ro");
      return (
        (!attentionOnly || conversation.attention) &&
        (!repliesOnly || !!conversation.received) &&
        (!hotOnly || conversation.hot) &&
        terms.includes(query.trim().toLocaleLowerCase("ro"))
      );
    })
    .sort(
      (a, b) =>
        messageTime(b.latest) - messageTime(a.latest) ||
        a.id.localeCompare(b.id),
    );
}
