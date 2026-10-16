import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sendingWindow,
  canDeliverReply,
  aiThinkingLevel,
  humanRequired,
  normalizePhone,
  bucharest,
  leadInput,
  campaignInput,
} from "../src/lib/domain.ts";
test("Bucharest morning window respects every weekday, weekends, boundaries and DST", () => {
  // Monday–Friday use the same evidence-backed morning interval.
  for (const day of [19, 20, 21, 22, 23]) {
    assert.equal(sendingWindow(new Date(`2026-10-${day}T04:59:59Z`)), false);
    assert.equal(sendingWindow(new Date(`2026-10-${day}T05:00:00Z`)), true);
    assert.equal(sendingWindow(new Date(`2026-10-${day}T08:59:59Z`)), true);
    assert.equal(sendingWindow(new Date(`2026-10-${day}T09:00:00Z`)), false);
  }
  for (const day of [24, 25])
    assert.equal(sendingWindow(new Date(`2026-10-${day}T08:00:00Z`)), false);
  // Romania changes from UTC+3 to UTC+2 on 25 October.
  assert.equal(sendingWindow(new Date("2026-10-26T05:59:59Z")), false);
  assert.equal(sendingWindow(new Date("2026-10-26T06:00:00Z")), true);
  assert.equal(sendingWindow(new Date("2026-10-26T10:00:00Z")), false);
  assert.equal(sendingWindow(new Date("2026-01-09T06:00:00Z")), true);
  assert.equal(bucharest(new Date("2026-09-25T15:30:00Z")).time, "18:30");
  assert.equal(
    sendingWindow(new Date("2026-10-19T11:00:00Z"), "13:00", "15:00"),
    true,
  );
});
test("Gemini thinking levels separate volume work from conversations", () => {
  for (const workflow of [
    "research",
    "outreach",
    "classification",
    "crm_summary",
  ])
    assert.equal(aiThinkingLevel(workflow), "minimal");
  for (const workflow of ["inbound_reply", "objection_reply", "demo"])
    assert.equal(aiThinkingLevel(workflow), "medium");
  assert.equal(humanRequired("Putem discuta un contract?"), true);
});
test("Romanian phone normalization is stable and international-safe", () => {
  assert.equal(normalizePhone("0722 123 456"), "+40722123456");
  assert.equal(normalizePhone("0040 722 123456"), "+40722123456");
  assert.equal(normalizePhone("+40722123456"), "+40722123456");
  assert.equal(normalizePhone(""), null);
});
test("input schemas reject dangerous URLs and invalid campaign windows", () => {
  assert.equal(
    leadInput.safeParse({ company_name: "Test", website: "file:///etc/passwd" })
      .success,
    false,
  );
  assert.equal(
    leadInput.safeParse({ company_name: "Test", email: "broken" }).success,
    false,
  );
  const base = {
    name: "Test",
    sender_identity: "test@example.invalid",
    tone: "profesional",
    offer: "demo",
    daily_cap: 25,
    window_start: "16:00",
    window_end: "09:00",
    mode: "approval_required",
    first_message: "",
    follow_up_1: "",
    follow_up_2: "",
  };
  assert.equal(campaignInput.safeParse(base).success, false);
  assert.equal(
    campaignInput.safeParse({
      ...base,
      window_start: "09:30",
      window_end: "16:30",
    }).success,
    true,
  );
});

test("only explicitly approved human replies can reach delivery", () => {
  const reply = {
    in_reply_to: "inbound",
    approved_by: "owner",
    metadata: { manual_reply: true, human_approved: true },
  };
  assert.equal(canDeliverReply(reply), true);
  assert.equal(
    canDeliverReply({ ...reply, metadata: { human_approved: true } }),
    false,
  );
  assert.equal(
    canDeliverReply({ ...reply, metadata: { manual_reply: true } }),
    false,
  );
  assert.equal(canDeliverReply({ ...reply, approved_by: null }), false);
  assert.equal(canDeliverReply({ ...reply, metadata: null }), false);
  assert.equal(canDeliverReply({ ...reply, metadata: [] }), false);
  assert.equal(
    canDeliverReply({ ...reply, in_reply_to: null, metadata: null }),
    true,
  );
});
