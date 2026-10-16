import { z } from "zod";
export const autopilotInput = z.object({
  input_mode: z.enum(["supplied", "brave_search"]).default("supplied"),
  selected_lead_ids: z.array(z.uuid()).max(100).default([]),
  city: z.string().trim().min(2).max(100),
  specialty: z.string().trim().min(2).max(100),
  require_website: z.boolean(),
  require_email: z.boolean(),
  require_phone: z.boolean(),
  daily_target: z.number().int().min(1).max(10),
  daily_api_limit: z.number().int().min(1).max(10),
  daily_ai_budget_usd: z.number().min(0).max(100),
  provider_request_cost_usd: z.number().min(0.001).max(1),
  storage_rights_confirmed: z.boolean(),
  min_fit_score: z.number().int().min(0).max(100),
});
export function domainOf(address: string) {
  try {
    const u = new URL(address);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password
      ? u.hostname.toLowerCase().replace(/^www\./, "")
      : null;
  } catch {
    return null;
  }
}
export function plain(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
export function specialtyMatches(actual: string | null, target: string) {
  const dental = /stomat|dentar|dental/;
  return (
    !!actual &&
    (dental.test(plain(target))
      ? dental.test(plain(actual))
      : plain(actual).includes(plain(target)))
  );
}
export function qualifySuppliedWithoutWebsite(
  lead: {
    company_name: string;
    city: string | null;
    niche: string | null;
    country: string | null;
    email: string | null;
    phone: string | null;
  },
  cfg: {
    city: string;
    specialty: string;
    require_website: boolean;
    require_email: boolean;
    require_phone: boolean;
    min_fit_score: number;
  },
) {
  const specialty = specialtyMatches(lead.niche, cfg.specialty);
  const city = !!lead.city && plain(lead.city) === plain(cfg.city);
  const fit = fitScore({
    specialty,
    city,
    website: false,
    contact: !!(lead.email || lead.phone),
  });
  return {
    fit,
    confidence: 0,
    qualified:
      !cfg.require_website &&
      !!lead.company_name.trim() &&
      specialty &&
      city &&
      /^(RO|romania)$/i.test(plain(lead.country || "")) &&
      (!cfg.require_email || !!lead.email) &&
      (!cfg.require_phone || !!lead.phone) &&
      fit >= cfg.min_fit_score,
  };
}
export function confirmed(
  fact: { value: string | null; quote: string | null },
  text: string,
) {
  return fact.value &&
    fact.quote &&
    text.toLowerCase().includes(fact.quote.toLowerCase()) &&
    plain(fact.quote).includes(plain(fact.value))
    ? fact.value
    : null;
}
export function confidenceScore(known: (string | null)[]) {
  return Math.round((100 * known.filter(Boolean).length) / known.length);
}
export function fitScore(input: {
  specialty: boolean;
  city: boolean;
  website: boolean;
  contact: boolean;
}) {
  return (
    (input.specialty ? 40 : 0) +
    (input.city ? 30 : 0) +
    (input.website ? 15 : 0) +
    (input.contact ? 15 : 0)
  );
}
export function nextBudgetDay(now = new Date()) {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return local;
}
