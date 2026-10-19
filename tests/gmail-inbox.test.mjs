import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inboxConversations,
  isDeliveryNotification,
  isInboxReply,
} from "../src/lib/gmail-inbox.ts";
const data = {
  campaigns: [
    { id: "a", sender_identity: "a@gmail.com" },
    { id: "b", sender_identity: "b@gmail.com" },
  ],
  leads: [
    {
      id: "lead-1",
      email: "doctor@clinica.ro",
      company_name: "Clinica",
      status: "REPLIED",
    },
    {
      id: "lead-2",
      email: "contact@cabinet.ro",
      company_name: "Cabinet",
      status: "HUMAN_REQUIRED",
    },
  ],
  messages: [
    {
      id: "old",
      lead_id: "lead-1",
      direction: "outbound",
      campaign_id: "a",
      created_at: "2026-10-12T08:00:00Z",
      metadata: {},
    },
    {
      id: "other-mailbox",
      lead_id: "lead-1",
      direction: "outbound",
      campaign_id: "b",
      created_at: "2026-10-12T09:00:00Z",
      metadata: {},
    },
    {
      id: "reply",
      lead_id: "lead-1",
      direction: "inbound",
      received_at: "2026-10-13T09:00:00Z",
      created_at: "2026-10-13T09:01:00Z",
      metadata: {
        mailbox_email: "a@gmail.com",
        from_email: "doctor@clinica.ro",
      },
    },
    {
      id: "attention",
      lead_id: "lead-2",
      direction: "inbound",
      received_at: "2026-10-13T10:00:00Z",
      created_at: "2026-10-11T09:00:00Z",
      metadata: {
        mailbox_email: "b@gmail.com",
        from_email: "manager@cabinet.ro",
        sender_mismatch: true,
      },
    },
  ],
};
test("Inbox mailbox filter preserves the right outbound thread and excludes another mailbox", () => {
  const conversations = inboxConversations(data, "", "a@gmail.com");
  assert.equal(conversations.length, 1);
  assert.deepEqual(
    conversations[0].messages.map((message) => message.id),
    ["old", "reply"],
  );
  assert.equal(conversations[0].received.id, "reply");
});
test("Inbox sorts by actual latest activity and searches the real reply sender", () => {
  assert.deepEqual(
    inboxConversations(data).map((conversation) => conversation.id),
    ["lead-2", "lead-1"],
  );
  assert.equal(inboxConversations(data, "MANAGER@CABINET.RO")[0].id, "lead-2");
  assert.deepEqual(
    inboxConversations(data, "", "", true).map(
      (conversation) => conversation.id,
    ),
    ["lead-2"],
  );
  assert.equal(inboxConversations(data, "no-match").length, 0);
});
test("An old sender warning does not keep a handled conversation in the attention filter", () => {
  const handled = {
    ...data,
    leads: data.leads.map((lead) => ({ ...lead, status: "REPLIED" })),
    messages: [
      ...data.messages,
      {
        id: "handled",
        lead_id: "lead-2",
        in_reply_to: "attention",
        status: "sent",
        direction: "outbound",
        campaign_id: "b",
        sent_at: "2026-10-13T11:00:00Z",
        created_at: "2026-10-13T11:00:00Z",
        metadata: {},
      },
    ],
  };
  assert.deepEqual(inboxConversations(handled, "", "", true), []);
});

test("reply sections exclude outbound-only threads and hot leads require confident intent", () => {
  const sample = structuredClone(data);
  sample.leads.push({
    id: "outbound-only",
    company_name: "Unanswered",
    email: "no@fixture.test",
  });
  sample.messages.push({
    id: "no-reply",
    lead_id: "outbound-only",
    direction: "outbound",
    created_at: "2026-10-14T00:00:00Z",
    metadata: {},
  });
  const reply = sample.messages.find((m) => m.id === "reply");
  reply.classification = "positive";
  reply.metadata = {
    ...reply.metadata,
    is_hot_lead: true,
    classification_confidence: 0.96,
  };
  assert.equal(inboxConversations(sample, "", "", false, true).length, 2);
  assert.deepEqual(
    inboxConversations(sample, "", "", false, true, true).map((c) => c.id),
    ["lead-1"],
  );
  reply.metadata.classification_confidence = 0.5;
  assert.equal(inboxConversations(sample, "", "", false, true, true).length, 0);
  reply.metadata.classification_confidence = 0.96;
  reply.classification = "refusal";
  assert.equal(inboxConversations(sample, "", "", false, true, true).length, 0);
  reply.classification = "positive";
  reply.metadata.sender_mismatch = true;
  assert.equal(inboxConversations(sample, "", "", false, true, true).length, 0);
  reply.metadata.sender_mismatch = false;
  sample.leads[0].do_not_contact = true;
  assert.equal(inboxConversations(sample, "", "", false, true, true).length, 0);
});

test("delivery failures are hidden from replies, hot leads and attention without removing history", () => {
  const sample = structuredClone(data);
  for (const from_email of [
    "mailer-daemon@googlemail.com",
    "MAILER-DAEMON@yahoo.com",
    "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
    "postmaster@outlook.com",
    "mailer-daemon+notice@example.com",
  ]) {
    const bounce = {
      id: "bounce",
      lead_id: "lead-1",
      direction: "inbound",
      created_at: "2026-10-15T10:00:00Z",
      classification: "positive",
      metadata: { from_email, is_hot_lead: true, classification_confidence: 1 },
    };
    assert.equal(isDeliveryNotification(bounce), true);
    assert.equal(isInboxReply(bounce), false);
    const bounceOnly = {
      ...sample,
      leads: sample.leads.map((lead) => ({
        ...lead,
        status: "HUMAN_REQUIRED",
      })),
      messages: [
        ...sample.messages.filter((m) => m.direction === "outbound"),
        bounce,
      ],
    };
    assert.deepEqual(inboxConversations(bounceOnly, "", "", false, true), []);
    assert.deepEqual(inboxConversations(bounceOnly, "", "", true, true), []);
    assert.deepEqual(
      inboxConversations(bounceOnly, "", "", false, true, true),
      [],
    );
    assert.equal(
      bounceOnly.messages.at(-1),
      bounce,
      "the stored history stays intact",
    );
  }
});

test("a delivery notice does not replace or reorder a real reply in a mixed conversation", () => {
  const sample = structuredClone(data);
  sample.messages.push({
    id: "late-bounce",
    lead_id: "lead-1",
    direction: "inbound",
    created_at: "2026-10-16T10:00:00Z",
    metadata: {
      from_email: "mailer-daemon@googlemail.com",
      sender_mismatch: true,
    },
  });
  const conversations = inboxConversations(sample, "", "", false, true);
  assert.deepEqual(
    conversations.map((c) => c.id),
    ["lead-2", "lead-1"],
  );
  const thread = conversations.find((c) => c.id === "lead-1");
  assert.equal(thread.received.id, "reply");
  assert.equal(thread.latest.id, "reply");
  assert.equal(thread.attention, false);
  assert.ok(thread.messages.every((m) => m.id !== "late-bounce"));
  for (const from_email of [
    "doctor@clinica.ro",
    "mailer-daemon-sales@clinica.ro",
    "manager@cabinet.ro",
  ]) {
    assert.equal(
      isInboxReply({ direction: "inbound", metadata: { from_email } }),
      true,
    );
  }
  assert.equal(
    isDeliveryNotification({
      direction: "outbound",
      metadata: { from_email: "postmaster@example.com" },
    }),
    false,
  );
});
