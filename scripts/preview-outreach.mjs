// Read-only model check. All leads here are synthetic fixtures; nothing is stored or sent.
import { GoogleGeminiProvider, safetyPrompt } from "../src/lib/providers/ai.ts";
import {
  buildLeadContext,
  generateOutreach,
  outreachOutputSchema,
  outreachSystemPrompt,
} from "../src/lib/outreach-template.ts";
import { writeFile } from "node:fs/promises";
const fact = "Clinica Maria oferă și consultații de ortodonție.";
const cases = [
  {
    label: "dentist_sparse",
    lead: {
      company_name: "Cabinet Dr. Mihai",
      contact_name: "Mihai",
      niche: "stomatologie",
    },
    contact: { name: "Mihai", position: "medic stomatolog" },
  },
  {
    label: "dentist_verified_fixture",
    lead: {
      company_name: "Clinica Maria",
      niche: "stomatologie",
      website: "https://maria.example.invalid",
      personalization_fact: fact,
      verified_facts: { personalization: fact },
    },
  },
  {
    label: "voice_fixture",
    lead: {
      company_name: "Clinica Arbor",
      niche: "medical",
      website: "https://arbor.example.invalid",
      verified_facts: { phone_booking: "da", online_booking: "nu" },
    },
  },
  {
    label: "website_sparse",
    lead: { company_name: "Atelierul Nord", niche: "mobilier" },
  },
  {
    label: "custom_software_fixture",
    lead: {
      company_name: "Logistica Delta",
      website: "https://delta.example.invalid",
      verified_facts: {
        operational_workflow:
          "Evidența comenzilor este ținută în fișiere Excel.",
      },
    },
  },
];
const provider = new GoogleGeminiProvider(),
  results = [];
for (const fixture of cases) {
  const context = buildLeadContext(fixture.lead, fixture.contact),
    rejections = [],
    bodies = [];
  try {
    const r = await generateOutreach({
      context,
      generate: async (prompt, attempt) => {
        const r = await provider.generate({
          model: "gemini-3.1-flash-lite",
          system: safetyPrompt + "\n" + outreachSystemPrompt,
          prompt,
          schema: outreachOutputSchema,
          name: "outreach",
          thinkingLevel: attempt === 0 ? "minimal" : "low",
          pricing: { inputPerMillion: 0.25, outputPerMillion: 1.5 },
          limits: { timeoutMs: 30000, maxOutputTokens: 2200, attempts: 1 },
        });
        bodies.push(r.value.email_body);
        return r;
      },
      onRejected: (reasons) => {
        rejections.push(reasons);
      },
    });
    results.push({
      label: fixture.label,
      ...r.value,
      model: r.model,
      costUsd: r.estimatedCostUsd,
      rejections,
    });
  } catch (e) {
    results.push({
      label: fixture.label,
      error: e.message,
      rejections,
      rejected_bodies: bodies,
    });
  }
}
await writeFile(
  new URL("../../artifacts/outreach-model-previews.json", import.meta.url),
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => r.error)) process.exitCode = 1;
