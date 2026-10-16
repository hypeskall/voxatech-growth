import { z } from "zod";
import type { Database } from "./supabase/database.types";
export type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export const statuses = [
  "NEW",
  "ENRICHING",
  "READY_FOR_OUTREACH",
  "CONTACTED",
  "FOLLOW_UP_1",
  "FOLLOW_UP_2",
  "REPLIED",
  "QUALIFIED",
  "DEMO_GENERATING",
  "DEMO_SENT",
  "TRIAL",
  "CHECKOUT_SENT",
  "WON",
  "LOST",
  "HUMAN_REQUIRED",
  "DO_NOT_CONTACT",
] as const;
export const statusLabels: Record<string, string> = {
  NEW: "Nou",
  ENRICHING: "În analiză",
  READY_FOR_OUTREACH: "Pregătit",
  CONTACTED: "Contactat",
  FOLLOW_UP_1: "Revenire 1",
  FOLLOW_UP_2: "Revenire 2",
  REPLIED: "A răspuns",
  QUALIFIED: "Calificat",
  DEMO_GENERATING: "Demo în lucru",
  DEMO_SENT: "Demo trimis",
  TRIAL: "În testare",
  CHECKOUT_SENT: "Plată trimisă",
  WON: "Câștigat",
  LOST: "Pierdut",
  HUMAN_REQUIRED: "Necesită atenție",
  DO_NOT_CONTACT: "Nu contacta",
};
export const categories = [
  "product",
  "pricing",
  "objections",
  "integrations",
  "onboarding",
  "compliance",
  "case_studies",
] as const;
export const categoryLabels: Record<string, string> = {
  product: "Produs",
  pricing: "Prețuri",
  objections: "Obiecții",
  integrations: "Integrări",
  onboarding: "Configurare",
  compliance: "Conformitate",
  case_studies: "Studii de caz",
};
const optionalText = z.string().trim().max(1000).nullable().optional();
export const leadInput = z.object({
  company_name: z.string().trim().min(2).max(200),
  niche: optionalText,
  city: optionalText,
  country: z.string().length(2).default("RO"),
  website: z
    .union([z.url().refine((v) => /^https?:/.test(v)), z.literal(""), z.null()])
    .optional(),
  email: z.union([z.email(), z.literal(""), z.null()]).optional(),
  phone: optionalText,
  contact_name: optionalText,
  google_rating: z
    .preprocess(
      (value) => (value === "" || value === null ? null : value),
      z.coerce.number().min(0).max(5).nullable(),
    )
    .optional(),
  review_count: z
    .preprocess(
      (value) => (value === "" || value === null ? null : value),
      z.coerce.number().int().min(0).nullable(),
    )
    .optional(),
  source: z.string().max(100).default("manual"),
  notes: z.string().max(20000).default(""),
  owner_id: z.uuid().nullable().optional(),
});
export const campaignInput = z
  .object({
    name: z.string().min(2).max(160),
    niche: optionalText,
    cities: z.array(z.string().max(100)).max(100).default([]),
    sender_identity: z.email(),
    tone: z.string().max(100),
    offer: z.string().max(2000),
    daily_cap: z.number().int().min(1).max(1000),
    window_start: z.string().regex(/^\d{2}:\d{2}$/),
    window_end: z.string().regex(/^\d{2}:\d{2}$/),
    mode: z.enum(["automatic", "approval_required"]),
    first_message: z.string().max(5000),
    follow_up_1: z.string().max(5000),
    follow_up_2: z.string().max(5000),
    target_filters: z
      .object({
        min_score: z
          .string()
          .regex(/^(100|[0-9]{1,2})$/)
          .optional(),
        source: z.string().max(100).optional(),
      })
      .default({}),
  })
  .refine((v) => v.window_start < v.window_end, "Interval orar invalid.");
export function normalizePhone(phone: string | null | undefined) {
  const p = (phone || "").replace(/[^\d+]/g, "");
  return /^0\d{9}$/.test(p)
    ? `+40${p.slice(1)}`
    : p.startsWith("00")
      ? `+${p.slice(2)}`
      : p || null;
}
export function humanRequired(text: string) {
  return /\b(gdpr|contract|contracte|juridic|legal|reducere|discount|integrare personalizat|integrare cu|api|securitate|date personale)\b/i.test(
    text,
  );
}
export function bucharest(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: !["Sat", "Sun"].includes(get("weekday")),
  };
}
export function sendingWindow(date: Date, start = "08:00", end = "12:00") {
  const p = bucharest(date);
  return p.weekday && p.time >= start && p.time < end;
}
export function aiThinkingLevel(
  workflow: string,
): "minimal" | "low" | "medium" {
  return ["inbound_reply", "objection_reply", "demo"].includes(workflow)
    ? "medium"
    : ["research", "outreach", "classification", "crm_summary"].includes(
          workflow,
        )
      ? "minimal"
      : "low";
}
export const money = (n: number, currency = "RON") =>
  new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
export const dateTime = (s: string | null | undefined) =>
  s
    ? new Intl.DateTimeFormat("ro-RO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Europe/Bucharest",
      }).format(new Date(s))
    : "—";

/** Replies require a human-written draft and explicit approval before delivery. */
export function canDeliverReply(message: {
  in_reply_to: string | null;
  approved_by?: string | null;
  metadata: unknown;
}) {
  if (!message.in_reply_to) return true;
  const meta =
    message.metadata &&
    typeof message.metadata === "object" &&
    !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : {};
  return (
    meta.manual_reply === true &&
    meta.human_approved === true &&
    !!message.approved_by
  );
}
