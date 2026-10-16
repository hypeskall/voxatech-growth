import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvedOutreachTemplate,
  outreachInstructions,
  validateOutreach,
  replyMailbox,
} from "../src/lib/outreach-template.ts";
test("approved owner template preserves free trial and signature and requires clinic personalization", () => {
  assert.equal(replyMailbox, "contact@voxatech.ro");
  assert.ok(
    approvedOutreachTemplate.includes(
      "30 de zile de test complet gratuit, fără nicio obligație ulterior.",
    ),
  );
  assert.ok(
    outreachInstructions("Clinic fixture", "Opt-out fixture").includes(
      "Opt-out fixture",
    ),
  );
  const personalized = approvedOutreachTemplate.replace(
    "echipa dvs.",
    "echipa Clinic fixture.",
  );
  assert.doesNotThrow(() => validateOutreach(personalized, "Clinic fixture"));
  assert.throws(() =>
    validateOutreach(approvedOutreachTemplate, "Clinic fixture"),
  );
  assert.throws(() =>
    validateOutreach(
      personalized.replace("30 de zile", "14 zile"),
      "Clinic fixture",
    ),
  );
  assert.throws(() =>
    validateOutreach(
      personalized.replace("Voxa a fost", "Voxa-OS a fost"),
      "Clinic fixture",
    ),
  );
});

test("personalization accepts researched facts but rejects an unverified imported claim", async () => {
  const { verifiedOutreachFact } =
    await import("../src/lib/outreach-template.ts");
  const fact = "Clinica tratează urgențe în aceeași zi.";
  assert.equal(
    verifiedOutreachFact({
      opening_hours: null,
      personalization_fact: fact,
      verified_facts: { personalization: fact },
    }),
    fact,
  );
  assert.equal(
    verifiedOutreachFact({
      opening_hours: null,
      personalization_fact: fact,
      verified_facts: {},
    }),
    null,
  );
  assert.equal(
    verifiedOutreachFact({
      opening_hours: { text: "Luni-vineri 9-17" },
      personalization_fact: fact,
      verified_facts: {},
    }),
    "Programul public verificat este: Luni-vineri 9-17.",
  );
});
