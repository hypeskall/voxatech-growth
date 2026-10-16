import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateLaunchReadiness,
  hasIdentityAndOptOut,
  launchConfirmation,
  validProspectEmail,
} from "../src/lib/launch.ts";

test("launch validation rejects placeholders and requires opt-out identity", () => {
  assert.equal(validProspectEmail("contact@clinica.ro"), true);
  assert.equal(validProspectEmail("info@website.com"), false);
  assert.equal(validProspectEmail("noreply@clinica.ro"), false);
  assert.equal(
    hasIdentityAndOptOut(
      "VoxaTech poate prelua apelurile. Dacă nu este relevant, îmi puteți spune și nu vă mai contactez.",
    ),
    true,
  );
  assert.equal(hasIdentityAndOptOut("VoxaTech poate prelua apelurile."), false);
});

test("real campaign launch requires every independent safety gate", () => {
  const ready = {
    senderVerified: true,
    recipients: [{ email: "contact@clinica.ro" }],
    drafts: [
      {
        approved: true,
        body: "VoxaTech răspunde. Dacă nu este relevant, îmi puteți spune și nu vă mai contactez.",
      },
    ],
    dailyCap: 10,
    confirmation: launchConfirmation,
    liveMode: true,
  };
  assert.equal(evaluateLaunchReadiness(ready).ready, true);
  for (const mutation of [
    { senderVerified: false },
    { recipients: [{ email: "info@website.com" }] },
    { drafts: [{ approved: false, body: ready.drafts[0].body }] },
    { drafts: [{ approved: true, body: "VoxaTech răspunde." }] },
    { dailyCap: 11 },
    { confirmation: "da" },
    { liveMode: false },
  ])
    assert.equal(
      evaluateLaunchReadiness({ ...ready, ...mutation }).ready,
      false,
    );
});

test("transport unsubscribe preserves the opt-out gate without forcing it into generated copy", () => {
  const body =
    "Bună ziua, un demo scurt pentru clinică.\n\nRareș\nVoxa Tech\nvoxatech.ro";
  assert.equal(hasIdentityAndOptOut(body), false);
  assert.equal(hasIdentityAndOptOut(body, true), true);
  assert.equal(hasIdentityAndOptOut("An anonymous offer", true), false);
  const result = evaluateLaunchReadiness({
    senderVerified: true,
    recipients: [{ email: "contact@clinica.ro" }],
    drafts: [{ approved: true, body, transportUnsubscribe: true }],
    dailyCap: 10,
    confirmation: launchConfirmation,
    liveMode: true,
  });
  assert.equal(result.ready, true);
});
