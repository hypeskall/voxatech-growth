import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autopilotInput,
  domainOf,
  confirmed,
  fitScore,
  confidenceScore,
  nextBudgetDay,
} from "../src/lib/autopilot-policy.ts";
test("autopilot normalizes domains and refuses unsafe discovery URLs", () => {
  assert.equal(domainOf("https://www.Clinic.RO/contact?a=1"), "clinic.ro");
  assert.equal(domainOf("file:///etc/passwd"), null);
  assert.equal(domainOf("https://user:secret@clinic.ro"), null);
});
test("research facts require exact quotes and cannot be invented", () => {
  assert.equal(
    confirmed(
      { value: "Clinica A", quote: "Clinica A în București" },
      "Clinica A în București",
    ),
    "Clinica A",
  );
  assert.equal(
    confirmed({ value: "Clinica B", quote: "Clinica A" }, "Clinica A"),
    null,
  );
  assert.equal(
    confirmed({ value: "Clinica A", quote: null }, "Clinica A"),
    null,
  );
  assert.equal(
    fitScore({ specialty: true, city: true, website: true, contact: true }),
    100,
  );
  assert.equal(confidenceScore(["a", null, null, null]), 25);
});
test("daily cap cannot exceed ten and day boundary uses Bucharest", () => {
  assert.equal(nextBudgetDay(new Date("2026-09-30T21:30:00Z")), "2026-10-01");
  assert.equal(
    autopilotInput.safeParse({
      city: "București",
      specialty: "Stomatologie",
      require_website: true,
      require_email: true,
      require_phone: false,
      daily_target: 11,
      daily_api_limit: 5,
      daily_ai_budget_usd: 1,
      provider_request_cost_usd: 0.005,
      storage_rights_confirmed: true,
      min_fit_score: 60,
    }).success,
    false,
  );
});

import { qualifySuppliedWithoutWebsite, specialtyMatches } from "../src/lib/autopilot-policy.ts";
test("website-free supplied qualification separates business fit from research confidence", () => {
 const lead={company_name:"Provided clinic",city:"Brașov",niche:"dental",country:"RO",email:"provided@example.invalid",phone:null};
 const cfg={city:"Brasov",specialty:"Stomatologie",require_website:false,require_email:true,require_phone:false,min_fit_score:60};
 assert.deepEqual(qualifySuppliedWithoutWebsite(lead,cfg),{fit:85,confidence:0,qualified:true});
 assert.equal(specialtyMatches("Stomatologie","dental"),true);
 for(const change of [{require_website:true},{require_phone:true},{min_fit_score:90},{city:"București"}]) assert.equal(qualifySuppliedWithoutWebsite(lead,{...cfg,...change}).qualified,false);
 assert.equal(qualifySuppliedWithoutWebsite({...lead,email:null},cfg).qualified,false);
 assert.equal(qualifySuppliedWithoutWebsite({...lead,niche:null},cfg).qualified,false);
});
