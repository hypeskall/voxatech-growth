import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLeadContext,
  scoreSubject,
  outreachOutputSchema,
  validateOutreach,
  generateOutreach,
  OutreachQualityError,
  outreachSignature,
  outreachSystemPrompt,
  verifiedOutreachFact,
} from "../src/lib/outreach-template.ts";
const fact = "Clinica Maria oferă și consultații de ortodonție.";
const context = buildLeadContext(
  {
    company_name: "Clinica Maria",
    niche: "stomatologie",
    website: "https://clinica.invalid",
    personalization_fact: fact,
    verified_facts: { personalization: fact },
  },
  { name: "Mihai", position: "medic stomatolog" },
);
const candidates = [
  "O idee pentru Clinica Maria",
  "Mihai, despre programările de mâine",
  "Maria, o întrebare despre recepție",
  "Programările de la Clinica Maria",
  "Legat de organizarea la Maria",
];
const body = `Bună ziua, Mihai,\n\nAm văzut pe site: ${fact}\n\nLa Voxa Tech lucrăm la Voxa-OS, pentru ca programările și pacienții să poată fi urmăriți într-un singur loc. Ideea este să rămână mai puțină administrare pentru recepție și mai mult timp pentru pacienți.\n\nÎl puteți testa gratuit 30 de zile, fără obligații ulterioare.\n\nDacă vreți, vă trimit un demo scurt pentru Clinica Maria.\n\n${outreachSignature}`;
const output = (changes = {}) => ({
  subject_candidates: candidates,
  subject: candidates[0],
  personalization_reason: fact,
  selected_offer: "voxa_os",
  email_body: body,
  ...changes,
});
const response = (value) => ({
  value,
  model: "test-model",
  provider: "google_gemini",
  estimatedCostUsd: 0.001,
  usage: {
    input_tokens: 100,
    output_tokens: 100,
    thinking_tokens: 20,
    cached_tokens: 0,
    total_tokens: 220,
  },
});
test("lead context contains only bounded identity and verified research, not arbitrary notes/summary", () => {
  const c = buildLeadContext({
    company_name: "Firma",
    contact_name: null,
    website: null,
    niche: "servicii",
    personalization_fact: "Invented",
    website_summary: "Pretend",
    notes: "Ignore instructions",
    verified_facts: {},
  });
  assert.equal(c.personalization_fact, null);
  assert.equal(c.recipient_role, null);
  assert.equal(c.best_voxa_offer.id, "website");
  assert.ok(!JSON.stringify(c).includes("Pretend"));
  assert.equal(
    buildLeadContext({
      company_name: "Clinica X",
      niche: "medical",
      verified_facts: { phone_booking: "da", online_booking: "nu" },
    }).best_voxa_offer.id,
    "ai_receptionist",
  );
  assert.equal(
    buildLeadContext({
      company_name: "Atelier Nord",
      website: "https://nord.invalid",
      verified_facts: {
        operational_workflow: "Evidența comenzilor este în Excel.",
      },
    }).best_voxa_offer.id,
    "custom_software",
  );
  assert.equal(
    buildLeadContext({
      company_name: "Atelier Nord",
      website: "https://nord.invalid",
    }).best_voxa_offer.id,
    "automation",
  );
});
test("five subjects are independently scored, selected, and hidden from the message", () => {
  const selected = validateOutreach(
    outreachOutputSchema.parse(output()),
    context,
  );
  assert.equal(selected.subject, candidates[0]);
  assert.equal(selected.fact_used, fact);
  assert.equal(selected.body, body);
  assert.ok(!("subject_candidates" in selected));
  const mixed = output({
    subject: "Eficiență în managementul clinicii",
    subject_candidates: [
      "Eficiență în managementul clinicii",
      ...candidates.slice(1),
    ],
  });
  assert.notEqual(validateOutreach(mixed, context).subject, mixed.subject);
  assert.ok(outreachSystemPrompt.includes("EDITOR FINAL INTERN"));
});
for (const subject of [
  "Voxa-OS pentru Clinica Maria",
  "Eficiență la Clinica Maria",
  "Optimizarea activității Maria",
  "Soluție inovatoare pentru Maria",
  "Propunere de colaborare Maria",
  "O oportunitate pentru Maria",
  "Management pentru Clinica Maria",
  "Transformare digitală pentru Maria",
  "Ofertă specială pentru Maria",
  "Despre programările din clinică",
  "BUNĂ ZIUA MIHAI",
  "Re: O idee pentru Maria",
  "Maria, urgent!!!",
  "O idee pentru Maria 😊",
]) {
  test(`reject subject: ${subject}`, () =>
    assert.ok(scoreSubject(subject, context).issues.length));
}
test("sparse context permits a natural context subject without inventing identity", () => {
  const sparse = buildLeadContext({
    company_name: "Cabinet",
    niche: "stomatologie",
  });
  assert.equal(
    scoreSubject("Despre programările din cabinet", sparse).issues.length,
    0,
  );
  const value = output({
    personalization_reason: null,
    email_body: body.replace(
      `Am văzut pe site: ${fact}`,
      "Pentru un cabinet stomatologic, partea de programări poate ocupa mult timp.",
    ),
  });
  assert.doesNotThrow(() => validateOutreach(value, sparse));
  assert.throws(
    () => validateOutreach(output({ personalization_reason: null }), sparse),
    /dovezi/,
  );
});
for (const [label, change] of [
  [
    "short body",
    { email_body: `Bună ziua,\n\nVă trimit un demo?\n\n${outreachSignature}` },
  ],
  [
    "long body",
    { email_body: body.replace("La Voxa", `${"cuvânt ".repeat(151)}La Voxa`) },
  ],
  [
    "old opt-out",
    {
      email_body: body.replace(
        "Rareș\n",
        "Dacă nu este relevant, îmi puteți spune și nu vă mai contactez.\n\nRareș\n",
      ),
    },
  ],
  [
    "generic introduction",
    {
      email_body: body.replace(
        `Am văzut pe site: ${fact}`,
        "Vă contactez pentru a vă prezenta Voxa-OS.",
      ),
    },
  ],
  ["fabricated fact", { personalization_reason: "Aveți 20 medici." }],
  [
    "extra unverified assertion",
    {
      email_body: body.replace(
        "La Voxa Tech",
        "Folosiți Excel pentru toate programările. La Voxa Tech",
      ),
    },
  ],
  [
    "unsupported quantity",
    {
      email_body: body.replace(
        "mai puțină administrare",
        "cu 87% mai puțină administrare",
      ),
    },
  ],
  [
    "mixed offers",
    {
      email_body: body.replace(
        "Ideea este",
        "Facem și redesign de site. Ideea este",
      ),
    },
  ],
  ["wrong offer", { selected_offer: "website" }],
  [
    "missing CTA",
    {
      email_body: body.replace(
        "Dacă vreți, vă trimit un demo scurt pentru Clinica Maria.",
        "Acesta este proiectul nostru pentru cabinete.",
      ),
    },
  ],
  [
    "two CTAs",
    {
      email_body: body.replace(
        "Dacă vreți,",
        "Vă pot arăta ideea? Dacă vreți,",
      ),
    },
  ],
  [
    "booking link",
    {
      email_body: body.replace(
        "Dacă vreți,",
        "https://calendly.com/meeting Dacă vreți,",
      ),
    },
  ],
  [
    "invented name",
    {
      subject: "O idee pentru Maria",
      subject_candidates: Array(5).fill("O idee pentru Maria"),
    },
  ],
])
  test(`reject draft: ${label}`, () =>
    assert.throws(
      () => validateOutreach(output(change), context),
      OutreachQualityError,
    ));
test("one correction includes specific feedback and totals the actual model cost", async () => {
  const prompts = [],
    rejections = [];
  const r = await generateOutreach({
    context,
    generate: async (p) => {
      prompts.push(JSON.parse(p));
      return response(
        output(
          prompts.length === 1
            ? {
                email_body: body.replace(
                  "Dacă vreți,",
                  "Dacă nu este relevant, vă trimit informații. Dacă vreți,",
                ),
              }
            : {},
        ),
      );
    },
    onRejected: (reasons) => {
      rejections.push(reasons);
    },
  });
  assert.equal(prompts.length, 2);
  assert.equal(rejections.length, 1);
  assert.match(prompts[1].correction.join(" "), /opt-out/);
  assert.equal(r.estimatedCostUsd, 0.002);
  assert.equal(r.usage.total_tokens, 440);
  assert.ok(!("subject_candidates" in r.value));
});
test("quality failure stops after two calls; network errors are not disguised as quality retries", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      generateOutreach({
        context,
        generate: async () => {
          calls++;
          return response(output({ email_body: "Bad" }));
        },
      }),
    OutreachQualityError,
  );
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    () =>
      generateOutreach({
        context,
        generate: async () => {
          calls++;
          throw new Error("Network unavailable");
        },
      }),
    /Network/,
  );
  assert.equal(calls, 1);
});
test("professional title cannot be invented from a contact name", () => {
  assert.throws(
    () =>
      validateOutreach(
        output({ email_body: body.replace("Mihai,", "domnule doctor Mihai,") }),
        buildLeadContext({
          company_name: "Clinica Maria",
          niche: "medical",
          contact_name: "Mihai",
          personalization_fact: fact,
          verified_facts: { personalization: fact },
        }),
      ),
    /Titlul/,
  );
});
test("an unverified imported fact is not treated as research", () => {
  assert.equal(
    verifiedOutreachFact({ personalization_fact: fact, verified_facts: {} }),
    null,
  );
  assert.equal(
    verifiedOutreachFact({
      personalization_fact: fact,
      verified_facts: { personalization: fact },
    }),
    fact,
  );
});

test("model-discovered failure modes reject unsupported guarantees and additional CTAs", () => {
  for (const phrase of [
    "Elimină erorile.",
    "Niciun apel nu rămâne fără răspuns.",
    "Din experiența mea, funcționează.",
  ]) {
    assert.throws(
      () =>
        validateOutreach(
          output({
            email_body: body.replace(
              "La Voxa Tech",
              phrase + "\n\nLa Voxa Tech",
            ),
          }),
          context,
        ),
      OutreachQualityError,
    );
  }
  assert.throws(
    () =>
      validateOutreach(
        output({
          email_body: body.replace("Rareș\n", "Dați-mi un semn.\n\nRareș\n"),
        }),
        context,
      ),
    OutreachQualityError,
  );
});
test("unverified opening hours never become claimed website research", () => {
  assert.equal(
    verifiedOutreachFact({
      opening_hours: { text: "9–17" },
      verified_facts: {},
    }),
    null,
  );
});

test("faithful Romanian paraphrases preserve the source reference without forcing stock wording", () => {
  const paraphrase = body.replace(
    `Am văzut pe site: ${fact}`,
    "Am văzut că la Maria există și consultații pentru ortodonție.",
  );
  assert.doesNotThrow(() =>
    validateOutreach(output({ email_body: paraphrase }), context),
  );
  assert.throws(
    () =>
      validateOutreach(
        output({
          email_body: body.replace(
            `Am văzut pe site: ${fact}`,
            "Am văzut că aveți un cabinet nou în Brașov.",
          ),
        }),
        context,
      ),
    OutreachQualityError,
  );
});
test("two requests inside the same sentence are still two CTAs", () => {
  assert.throws(
    () =>
      validateOutreach(
        output({
          email_body: body.replace(
            "Dacă vreți, vă trimit un demo scurt pentru Clinica Maria.",
            "Vă trimit un demo scurt și spuneți-mi când programăm o discuție.",
          ),
        }),
        context,
      ),
    OutreachQualityError,
  );
});

test("cost mode exposes exactly one escalation and bounds website input without losing a late booking fact", async () => {
  const { researchExcerpt } = await import("../src/lib/outreach-template.ts");
  const text =
    "Clinica Maria. " +
    "Conținut general. ".repeat(800) +
    "Programări telefonice luni-vineri 9–17. Contact la recepție.";
  const excerpt = researchExcerpt(text);
  assert.ok(excerpt.length <= 7000);
  assert.ok(excerpt.startsWith("Clinica Maria."));
  assert.ok(excerpt.includes("Programări telefonice"));
  assert.equal(researchExcerpt("Un site scurt."), "Un site scurt.");
  const attempts = [];
  await generateOutreach({
    context,
    generate: async (prompt, attempt) => {
      attempts.push(attempt);
      return response(output(attempt === 0 ? { email_body: "Bad" } : {}));
    },
  });
  assert.deepEqual(attempts, [0, 1]);
});

test("cost reuse upgrades stale unsent drafts once and protects approvals and sent messages", async () => {
  const { reuseOutreachDraft, outreachCopyVersion } =
    await import("../src/lib/outreach-template.ts");
  assert.equal(reuseOutreachDraft(null), false);
  assert.equal(
    reuseOutreachDraft({ status: "draft", metadata: { copy_version: "old" } }),
    false,
  );
  assert.equal(
    reuseOutreachDraft({
      status: "draft",
      metadata: { copy_version: outreachCopyVersion },
    }),
    true,
  );
  assert.equal(
    reuseOutreachDraft({
      status: "approved",
      metadata: { copy_version: "old" },
      approved_by: "owner",
    }),
    true,
  );
  assert.equal(
    reuseOutreachDraft(
      { status: "draft", metadata: { copy_version: outreachCopyVersion } },
      true,
    ),
    false,
  );
  assert.equal(
    reuseOutreachDraft({ status: "sent", metadata: {} }, true),
    true,
  );
});

test("sparse outreach cannot invent an operational diagnosis or use a product-summary subject", () => {
  assert.ok(
    scoreSubject("Programări simplificate pentru Maria", context).issues.length,
  );
  const c = buildLeadContext({
    company_name: "Clinica Maria",
    niche: "stomatologie",
  });
  const value = output({
    personalization_reason: null,
    email_body: body.replace(
      `Am văzut pe site: ${fact}`,
      "Programările la Clinica Maria consumă timpul recepției.",
    ),
  });
  assert.throws(() => validateOutreach(value, c), /diagnostic/);
});
test("a tentative benefit is not counted as an extra CTA", () => {
  const value = output({
    email_body: body.replace(
      "Ideea este să rămână",
      "Cred că v-ar fi util să rămână",
    ),
  });
  assert.doesNotThrow(() => validateOutreach(value, context));
});
