import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sendingWindow,
  aiThinkingLevel,
  humanRequired,
  normalizePhone,
  bucharest,
  leadInput,
  campaignInput,
} from "../src/lib/domain.ts";
test("Bucharest sending window honors summer time, boundaries, and weekends", () => {
  assert.equal(sendingWindow(new Date("2026-09-25T06:30:00Z")), true);
  assert.equal(sendingWindow(new Date("2026-09-25T06:29:00Z")), false);
  assert.equal(sendingWindow(new Date("2026-09-25T13:30:00Z")), false);
  assert.equal(sendingWindow(new Date("2026-09-26T08:00:00Z")), false);
  assert.equal(sendingWindow(new Date("2026-01-09T07:30:00Z")), true);
  assert.equal(bucharest(new Date("2026-09-25T15:30:00Z")).time, "18:30");
});
test("Gemini thinking levels separate volume work from conversations", () => {
  for (const workflow of [
    "research",
    "outreach",
    "classification",
    "crm_summary",
  ])
    assert.equal(aiThinkingLevel(workflow), "low");
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
