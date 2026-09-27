"use client";
import { useState } from "react";
import { Ambient, AnimatedValue } from "./ambient";
import { BrandMark } from "./brand-mark";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import {
  LayoutDashboard,
  Users,
  Send,
  Inbox,
  AudioLines,
  BookOpen,
  ChartNoAxesCombined,
  Settings,
  ChevronRight,
  Plus,
  Upload,
  Download,
  Search,
  ArrowUpRight,
  RefreshCw,
  Bell,
  Menu,
  CalendarDays,
  Sparkles,
  ShieldCheck,
  Clock,
  Play,
  Pause,
  Ellipsis,
  Mail,
  Globe,
  Check,
  ChevronLeft,
  LogOut,
  ExternalLink,
  FileText,
  Target,
  Wallet,
  CheckCircle2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { Table } from "./ui/table";
import { ImportDialog } from "./import-dialog";
import { CampaignReviewCenter } from "./campaign-review-center";
import {
  statuses,
  statusLabels,
  categories,
  categoryLabels,
  dateTime,
  money,
  bucharest,
  type Row,
} from "@/lib/domain";
import type { Snapshot } from "@/lib/snapshot";
import type { Json } from "@/lib/supabase/database.types";
const nav = [
  ["dashboard", "Privire de ansamblu", LayoutDashboard],
  ["leads", "Prospecte", Users],
  ["campaigns", "Campanii", Send],
  ["inbox", "Conversații", Inbox],
  ["demos", "Demo-uri", AudioLines],
  ["knowledge-base", "Bază de cunoștințe", BookOpen],
  ["analytics", "Analize", ChartNoAxesCombined],
] as const;
const roleNames: Record<string, string> = {
  owner: "Proprietar",
  admin: "Administrator",
  operator: "Operator",
  viewer: "Vizualizare",
};
const jobNames: Record<string, string> = {
  enrich_new_leads: "Analiză prospect",
  create_outreach_drafts: "Redactare mesaj",
  send_due_messages: "Trimitere mesaj",
  process_follow_ups: "Revenire automată",
  process_inbound_replies: "Procesare răspuns",
  generate_requested_demos: "Generare demo",
  notify_human_required: "Notificare echipă",
  sync_payment_events: "Sincronizare plată",
  daily_summary: "Rezumat zilnic",
};
const labels: Record<string, string> = {
  draft: "Ciornă",
  approved: "Aprobat",
  queued: "În așteptare",
  sending: "În curs",
  sent: "Trimis",
  delivered: "Livrat",
  opened: "Deschis",
  received: "Primit",
  bounced: "Respins",
  failed: "Eroare",
  cancelled: "Anulat",
  active: "Activă",
  paused: "În pauză",
  archived: "Arhivată",
  pending: "În așteptare",
  running: "În lucru",
  completed: "Finalizat",
  script_pending: "Scenariu în lucru",
  audio_awaiting_configuration: "Audio în așteptarea configurării",
  generating: "Se generează",
  ready: "Pregătit",
  in_progress: "În lucru",
};
const activityLabels: Record<string, string> = {
  insert: "Înregistrare creată",
  update: "Înregistrare actualizată",
  delete: "Înregistrare ștearsă",
  job_completed: "Automatizare finalizată",
  job_failed: "Automatizare nereușită",
  ai_research: "Analiză AI finalizată",
  ai_outreach: "Mesaj redactat cu AI",
  ai_reply: "Răspuns analizat cu AI",
  ai_demo: "Scenariu demo generat",
  ai_controlled_test_completed: "Test AI controlat finalizat",
  ai_batch_evaluation: "Evaluare AI de lot finalizată",
  email_sent: "Email trimis",
  email_simulated: "Trimitere simulată în modul local",
  email_preview_logged: "Email pregătit în modul local",
  message_approve: "Mesaj aprobat",
  message_save: "Mesaj editat",
  message_reject: "Mesaj respins la revizuire",
  message_note: "Notă internă actualizată",
  message_regenerate: "Ciornă regenerată",
  message_test_sent: "Test intern trimis",
  campaign_active: "Campanie activată",
  campaign_paused: "Campanie pusă în pauză",
  campaign_archived: "Campanie arhivată",
  demo_viewed: "Demo vizualizat",
  demo_listened: "Demo ascultat",
  onboarding_completed: "Onboarding finalizat",
};
const outreachCopyVersion = "pain-first-v3";
function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["WON", "ready", "completed", "active", "delivered"].includes(value) ? "green" : ["HUMAN_REQUIRED", "failed", "bounced"].includes(value) ? "amber" : ["DO_NOT_CONTACT", "LOST"].includes(value) ? "red" : ["QUALIFIED", "DEMO_SENT", "TRIAL", "approved"].includes(value) ? "purple" : ""}`}
    >
      {statusLabels[value] || labels[value] || value}
    </span>
  );
}
function Empty({
  title,
  text,
  children,
  icon: Icon = Users,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
  icon?: typeof Users;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <strong>{title}</strong>
      <p>{text}</p>
      {children}
    </div>
  );
}
function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <small>{subtitle}</small>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Metric({
  label,
  value,
  note,
  icon: Icon = Target,
}: {
  label: string;
  value: string | number;
  note: string;
  icon?: typeof Users;
}) {
  return (
    <div className="panel metric">
      <div className="metric-label">
        {label}
        <Icon size={17} className="metric-icon" />
      </div>
      <div className="metric-value">
        <AnimatedValue value={value} />
      </div>
      <div className="metric-note">{note}</div>
    </div>
  );
}
function Field({
  label,
  name,
  defaultValue = "",
  type = "text",
  required = false,
  full = false,
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: string;
  required?: boolean;
  full?: boolean;
  step?: string;
}) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        step={step}
      />
    </label>
  );
}
function Area({
  label,
  name,
  value = "",
  rows = 5,
}: {
  label: string;
  name: string;
  value?: string;
  rows?: number;
}) {
  return (
    <label className="field full">
      {label}
      <textarea name={name} defaultValue={value} rows={rows} />
    </label>
  );
}
function jsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
export function Workspace({
  initial,
  path,
}: {
  initial: Snapshot;
  path: string;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState<
    "lead" | "campaign" | "knowledge" | "import" | null
  >(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    run: () => Promise<unknown>;
  } | null>(null);
  const [tab, setTab] = useState("overview");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [bulkCampaign, setBulkCampaign] = useState("");
  const [bulkStatus, setBulkStatus] = useState("NEW");
  const [inboxLead, setInboxLead] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const section = path.split("/")[0];
  const leadId = section === "leads" ? path.split("/")[1] : undefined;
  const campaignReviewId =
    section === "campaigns" && path.split("/")[2] === "review"
      ? path.split("/")[1]
      : undefined;
  const manager = ["owner", "admin"].includes(data.user.role);
  const canEdit = data.user.role !== "viewer";
  const title =
    path === "settings/integrations"
      ? "Integrări"
      : section === "settings"
        ? "Setări"
        : nav.find((n) => n[0] === section)?.[1] || "Voxa Growth";
  const tell = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 6500);
  };
  async function refresh() {
    const response = await fetch("/api/snapshot");
    if (!response.ok) throw new Error("Nu am putut actualiza datele.");
    setData(await response.json());
  }
  async function act(action: string, input: unknown) {
    setBusy(true);
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data: input }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Acțiune nereușită.");
      if (action === "logout") {
        router.push("/login");
        router.refresh();
        return result;
      }
      await refresh();
      tell("Modificările au fost salvate.");
      return result;
    } catch (error) {
      tell(error instanceof Error ? error.message : "Eroare neașteptată.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  const open = (type: typeof modal, id: string | null = null) => {
    setEdit(id);
    setModal(type);
  };
  const leadName = (id: string | null) =>
    data.leads.find((l) => l.id === id)?.company_name || "VoxaTech";
  const today = bucharest().date;
  const leads = data.leads;
  const count = (status: string) =>
    leads.filter((l) => l.status === status).length;
  const revenue = leads.reduce(
    (sum, l) => sum + (l.currency === "RON" ? l.revenue_won : 0),
    0,
  );
  const filtered = leads.filter(
    (l) =>
      (!query ||
        [l.company_name, l.email, l.city, l.contact_name]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!filters.status || l.status === filters.status) &&
      (!filters.city || l.city === filters.city) &&
      (!filters.niche || l.niche === filters.niche) &&
      (!filters.source || l.source === filters.source) &&
      (!filters.owner || l.owner_id === filters.owner) &&
      (!filters.score || (l.lead_score || 0) >= Number(filters.score)) &&
      (!filters.campaign ||
        data.campaign_leads.some(
          (cl) => cl.lead_id === l.id && cl.campaign_id === filters.campaign,
        )),
  );
  const options = (field: "city" | "niche" | "source") =>
    [
      ...new Set(leads.map((l) => l[field]).filter((v): v is string => !!v)),
    ].sort();
  const selectedLead = leads.find((l) => l.id === leadId);
  const editLead = leads.find((l) => l.id === edit);
  const editCampaign = data.campaigns.find((c) => c.id === edit);
  const editKnowledge = data.knowledge_base_documents.find(
    (d) => d.id === edit,
  );
  function reviewActivities(campaignId: string) {
    const seen = new Set<string>();
    return data.activities.filter((activity) => {
      const details = jsonObject(activity.details);
      if (
        activity.action !== "ai_batch_evaluation" ||
        details.campaign_id !== campaignId ||
        details.copy_version !== outreachCopyVersion ||
        !activity.lead_id ||
        seen.has(activity.lead_id)
      )
        return false;
      seen.add(activity.lead_id);
      return true;
    });
  }
  function reviewRows(campaignId: string) {
    const activities = new Map(
      reviewActivities(campaignId).map((activity) => [
        activity.lead_id,
        activity,
      ]),
    );
    return data.campaign_leads
      .filter((item) => item.campaign_id === campaignId)
      .map((item) => {
        const lead = data.leads.find((candidate) => candidate.id === item.lead_id);
        const primaryDraft = data.messages.find((message) => {
          const metadata = jsonObject(message.metadata);
          return (
            message.campaign_id === campaignId &&
            message.lead_id === item.lead_id &&
            metadata.outreach_variant === "B" &&
            metadata.copy_version === outreachCopyVersion
          );
        });
        return {
          lead,
          draft: primaryDraft,
          activity: activities.get(item.lead_id),
        };
      });
  }
  function filter(key: string, value: string) {
    setFilters({ ...filters, [key]: value });
    setPage(0);
  }
  const leadActions = (id: string) => (
    <div className="actions">
      <Button
        size="sm"
        variant="secondary"
        disabled={!canEdit || busy}
        onClick={() => act("bulk_enrich", { ids: [id] })}
      >
        <Sparkles size={14} />
        Analizează
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={!canEdit || busy}
        onClick={() => act("bulk_draft", { ids: [id] })}
      >
        Generează mesaj
      </Button>
      <Button
        size="sm"
        disabled={!canEdit || busy}
        onClick={() => act("demo", { ids: [id] })}
      >
        <AudioLines size={14} />
        Generează demo
      </Button>
    </div>
  );
  const timeline = (items: Row<"activities">[]) =>
    items.length ? (
      items.slice(0, 30).map((a) => {
        const details = jsonObject(a.details);
        const hasAiTrace =
          a.action.startsWith("ai_") &&
          details.input !== undefined &&
          details.output !== undefined;
        return (
          <div className="list-row activity-row" key={a.id}>
            <div className="row-main">
              <span className="event-dot" />
              <div>
                <strong>{activityLabels[a.action] || a.action}</strong>
                <small>
                  {leadName(a.lead_id)}
                  {details.provider === "google_gemini"
                    ? " · Google Gemini"
                    : ""}
                  {a.model ? ` · ${a.model}` : ""}
                  {details.thinking_level
                    ? ` · gândire ${String(details.thinking_level)}`
                    : ""}
                  {details.usage &&
                  typeof details.usage === "object" &&
                  !Array.isArray(details.usage)
                    ? ` · ${Number(details.usage.total_tokens || 0)} tokenuri`
                    : ""}
                  {details.latency_ms
                    ? ` · ${Number(details.latency_ms)} ms`
                    : ""}
                  {details.estimated_cost_usd !== undefined
                    ? ` · $${Number(details.estimated_cost_usd).toFixed(6)}`
                    : ""}
                </small>
              </div>
            </div>
            <small>{dateTime(a.created_at)}</small>
            {hasAiTrace && (
              <details className="ai-trace">
                <summary>Vezi intrarea și ieșirea exactă</summary>
                <pre>{JSON.stringify(details, null, 2)}</pre>
              </details>
            )}
          </div>
        );
      })
    ) : (
      <Empty
        icon={Clock}
        title="Activitatea începe aici"
        text="Modificările, analizele și automatizările vor apărea în jurnal."
      />
    );
  function exportCSV() {
    const safe = filtered.map((l) => ({
      company_name: l.company_name,
      niche: l.niche,
      city: l.city,
      website: l.website,
      email: l.email,
      phone: l.phone,
      status: l.status,
      lead_score: l.lead_score,
    }));
    const csv = Papa.unparse(safe, { escapeFormulae: true });
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `voxa-prospecte-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function messageCard(m: Row<"messages">) {
    const metadata = jsonObject(m.metadata);
    return (
      <div
        key={m.id}
        className={`message ${m.direction === "outbound" ? "outbound" : ""}`}
      >
        <div className="message-top">
          <span>
            {m.direction === "outbound"
              ? "Echipa VoxaTech"
              : leadName(m.lead_id)}{" "}
            · {dateTime(m.created_at)}
            {metadata.outreach_variant
              ? ` · Varianta ${String(metadata.outreach_variant)}${metadata.primary_style ? " · Recomandată" : ""}`
              : ""}
          </span>
          <Badge value={m.status} />
        </div>
        {m.subject && <h3 style={{ marginBottom: 10 }}>{m.subject}</h3>}
        <p className="copy">{m.body}</p>
        {m.model && (
          <small style={{ display: "block", marginTop: 12 }}>
            Model: {m.model} · {m.knowledge_document_ids.length} surse interne
            {metadata.estimated_cost_usd !== undefined
              ? ` · cost estimat $${Number(metadata.estimated_cost_usd).toFixed(6)}`
              : ""}
          </small>
        )}
        {m.direction === "outbound" &&
          ["draft", "approved", "queued"].includes(m.status) &&
          canEdit && (
            <div className="actions section-gap">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const body = window.prompt(
                    "Editează mesajul înainte de aprobare:",
                    m.body,
                  );
                  if (body) act("message_save", { id: m.id, body });
                }}
              >
                Editează
              </Button>
              {m.status === "draft" && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      title: "Aprobă mesajul",
                      text:
                        data.delivery === "live"
                          ? "Mesajul va putea fi trimis de campania activă, în intervalul configurat."
                          : "Mesajul va fi aprobat și înregistrat ca trimitere simulată. Niciun email extern nu va fi trimis.",
                      run: () => act("message_approve", { id: m.id }),
                    })
                  }
                >
                  <Check size={14} />
                  Aprobă
                </Button>
              )}
            </div>
          )}
      </div>
    );
  }
  const cohort = leads.filter(
    (l) =>
      (!range.from || l.created_at.slice(0, 10) >= range.from) &&
      (!range.to || l.created_at.slice(0, 10) <= range.to),
  );
  const ids = new Set(cohort.map((l) => l.id));
  const cohortMessages = data.messages.filter((m) => ids.has(m.lead_id));
  const contacted = new Set(
    cohortMessages
      .filter((m) => m.direction === "outbound" && m.sent_at)
      .map((m) => m.lead_id),
  );
  const replied = new Set(
    cohortMessages
      .filter((m) => m.direction === "inbound")
      .map((m) => m.lead_id),
  );
  const qualifiedReached = new Set([
    ...leads
      .filter((lead) =>
        [
          "QUALIFIED",
          "DEMO_GENERATING",
          "DEMO_SENT",
          "TRIAL",
          "CHECKOUT_SENT",
          "WON",
        ].includes(lead.status),
      )
      .map((lead) => lead.id),
    ...data.messages
      .filter((message) => message.classification === "positive")
      .map((message) => message.lead_id),
    ...data.activities
      .filter(
        (activity) => jsonObject(activity.details).to_status === "QUALIFIED",
      )
      .flatMap((activity) => (activity.lead_id ? [activity.lead_id] : [])),
  ]);
  const demoReached = new Set(data.demos.map((demo) => demo.lead_id));
  const trialReached = new Set([
    ...leads
      .filter((lead) => ["TRIAL", "CHECKOUT_SENT", "WON"].includes(lead.status))
      .map((lead) => lead.id),
    ...data.activities
      .filter((activity) => jsonObject(activity.details).to_status === "TRIAL")
      .flatMap((activity) => (activity.lead_id ? [activity.lead_id] : [])),
  ]);
  const reachedInCohort = (reached: Set<string>) =>
    [...reached].filter((leadId) => ids.has(leadId)).length;
  const percent = (n: number, d = cohort.length) =>
    d ? `${Math.round((n / d) * 100)}%` : "0%";
  const byStatus = (arr: typeof leads, status: string) =>
    arr.filter((l) => l.status === status).length;
  const topGroup = (field: "niche" | "city") =>
    Object.entries(
      cohort.reduce<Record<string, number>>((a, l) => {
        const key = l[field] || "Necunoscut";
        a[key] = (a[key] || 0) + 1;
        return a;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  const costs = jsonObject(
    data.settings.find((s) => s.key === "costs")?.value || {},
  );
  const pricedActivities = data.activities.filter(
    (a) =>
      (!a.lead_id || ids.has(a.lead_id)) &&
      Number.isFinite(Number(jsonObject(a.details).estimated_cost_usd)),
  );
  const estimated = pricedActivities.reduce(
    (sum, activity) =>
      sum + Number(jsonObject(activity.details).estimated_cost_usd || 0),
    0,
  );
  const geminiIntegration = data.integrations.find(
    (integration) => integration.provider === "google_gemini",
  );
  const resendIntegration = data.integrations.find(
    (integration) => integration.provider === "resend",
  );
  const resendConfig = jsonObject(resendIntegration?.public_config || {});
  const geminiHealthy =
    data.providers.google_gemini &&
    !!geminiIntegration?.last_verified_at &&
    jsonObject(geminiIntegration.public_config).health === "healthy";
  return (
    <div className="shell">
      <Ambient />
      {busy && <div className="loading-bar" />}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <Link className="brand" href="/dashboard">
          <BrandMark />
          <div>
            voxa<small>GROWTH</small>
          </div>
        </Link>
        <div className="workspace-name">
          <span className="mini-avatar">V</span>
          <div>
            VoxaTech
            <small style={{ display: "block", fontSize: 11 }}>
              Spațiu de lucru intern
            </small>
          </div>
        </div>
        <div className="nav-caption">SPAȚIU DE LUCRU</div>
        <nav className="nav">
          {nav.map(([url, label, Icon]) => (
            <Link
              key={url}
              href={`/${url}`}
              className={section === url ? "active" : ""}
              onClick={() => setMobile(false)}
            >
              <Icon size={18} />
              {label}
              {url === "inbox" &&
                data.messages.filter(
                  (m) => m.direction === "inbound" && !m.classification,
                ).length > 0 && (
                  <span className="badge purple">
                    {
                      data.messages.filter(
                        (m) => m.direction === "inbound" && !m.classification,
                      ).length
                    }
                  </span>
                )}
            </Link>
          ))}
        </nav>
        <div className="nav-bottom">
          <div className="nav-caption">ADMINISTRARE</div>
          <nav className="nav">
            <Link
              href="/settings/integrations"
              className={path === "settings/integrations" ? "active" : ""}
            >
              <ShieldCheck size={18} />
              Integrări
            </Link>
            <Link
              href="/settings"
              className={path === "settings" ? "active" : ""}
            >
              <Settings size={18} />
              Setări
            </Link>
          </nav>
        </div>
        <div className="account">
          <div className="mini-avatar">
            {(
              data.profiles.find((p) => p.id === data.user.id)?.full_name ||
              data.user.email
            )
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div>
            <strong>{roleNames[data.user.role]}</strong>
            <span title={data.user.email}>{data.user.email}</span>
          </div>
          <button
            className="icon-button"
            aria-label="Deconectare"
            onClick={() => act("logout", {})}
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="actions">
            <button
              className="icon-button mobile-menu"
              aria-label="Deschide meniul"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Spațiu de lucru{" "}
              <ChevronRight
                size={12}
                style={{ display: "inline", margin: "0 9px" }}
              />
              <b>{title}</b>
            </span>
          </div>
          <div className="top-meta">
            <span>
              <CalendarDays
                size={14}
                style={{ display: "inline", marginRight: 7 }}
              />
              {new Date().toLocaleDateString("ro-RO", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "Europe/Bucharest",
              })}
            </span>
            <button
              className="icon-button"
              aria-label="Actualizează datele"
              onClick={() =>
                refresh()
                  .then(() => tell("Date actualizate."))
                  .catch(() => tell("Actualizarea a eșuat."))
              }
            >
              <RefreshCw size={17} />
            </button>
            <Link
              href="/dashboard#notifications"
              aria-label="Notificări"
              className="icon-button"
            >
              <Bell size={18} />
            </Link>
            <div className="mini-avatar">
              {(
                data.profiles.find((p) => p.id === data.user.id)?.full_name ||
                data.user.email
              ).slice(0, 1)}
            </div>
          </div>
        </header>
        <div className="content" key={path}>
          <div className="page-heading">
            <div>
              <h1>{selectedLead ? selectedLead.company_name : title}</h1>
              <p>
                {selectedLead
                  ? "Informații, conversații și următorul pas."
                  : section === "dashboard"
                    ? "Tot ce contează pentru creșterea VoxaTech, într-un singur loc."
                    : section === "leads"
                      ? `${leads.length} prospecte · de la prima interacțiune la client.`
                      : section === "campaigns"
                        ? "Conversații relevante, la momentul potrivit."
                        : section === "inbox"
                          ? "Răspunsuri, ciorne și conversații care merită atenție."
                          : section === "demos"
                            ? "O experiență VoxaTech, personalizată pentru fiecare clinică."
                            : section === "knowledge-base"
                              ? "Sursa de adevăr pentru fiecare răspuns generat."
                              : section === "analytics"
                                ? "Înțelege ce funcționează în procesul de vânzare."
                                : "Configurează spațiul de lucru și automatizările."}
              </p>
            </div>
            <div className="header-actions">
              {section === "dashboard" && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => open("import")}
                    disabled={!canEdit}
                  >
                    <Upload size={16} />
                    Import CSV
                  </Button>
                  <Button onClick={() => open("lead")} disabled={!canEdit}>
                    <Plus size={17} />
                    Adaugă prospect
                  </Button>
                </>
              )}
              {section === "leads" && !leadId && (
                <>
                  <Button variant="secondary" onClick={exportCSV}>
                    <Download size={15} />
                    Export
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => open("import")}
                    disabled={!canEdit}
                  >
                    <Upload size={15} />
                    Import CSV
                  </Button>
                  <Button onClick={() => open("lead")} disabled={!canEdit}>
                    <Plus size={16} />
                    Prospect nou
                  </Button>
                </>
              )}
              {selectedLead && (
                <Button
                  variant="secondary"
                  onClick={() => open("lead", selectedLead.id)}
                  disabled={!canEdit}
                >
                  Editează prospectul
                </Button>
              )}
              {section === "campaigns" && (
                <Button disabled={!manager} onClick={() => open("campaign")}>
                  <Plus size={16} />
                  Campanie nouă
                </Button>
              )}
              {section === "knowledge-base" && (
                <Button disabled={!manager} onClick={() => open("knowledge")}>
                  <Plus size={16} />
                  Document nou
                </Button>
              )}
            </div>
          </div>
          {data.delivery === "log" && (
            <div className="notice">
              <ShieldCheck size={17} />
              <span>
                Mod local activ. Trimiterile aprobate sunt înregistrate ca
                simulări; niciun email nu părăsește aplicația.
              </span>
              <Link
                href="/settings/integrations"
                className="text-link"
                style={{ marginLeft: "auto" }}
              >
                Vezi integrările{" "}
                <ArrowUpRight size={12} style={{ display: "inline" }} />
              </Link>
            </div>
          )}
          {section === "dashboard" && (
            <>
              <div className="metrics">
                <Metric
                  label="Prospecte noi azi"
                  value={
                    leads.filter(
                      (l) => bucharest(new Date(l.created_at)).date === today,
                    ).length
                  }
                  note={`${leads.length} prospecte în total`}
                  icon={Users}
                />
                <Metric
                  label={
                    data.delivery === "log"
                      ? "Contactări simulate azi"
                      : "Contactate azi"
                  }
                  value={
                    new Set(
                      data.messages
                        .filter(
                          (m) =>
                            m.sent_at &&
                            bucharest(new Date(m.sent_at)).date === today,
                        )
                        .map((m) => m.lead_id),
                    ).size
                  }
                  note={
                    data.delivery === "log"
                      ? "Livrări locale, fără email extern"
                      : "Conversații începute prin email"
                  }
                  icon={Send}
                />
                <Metric
                  label="Răspunsuri primite"
                  value={
                    new Set(
                      data.messages
                        .filter((m) => m.direction === "inbound")
                        .map((m) => m.lead_id),
                    ).size
                  }
                  note="Prospecte care au răspuns"
                  icon={Inbox}
                />
                <Metric
                  label="Venit câștigat"
                  value={money(revenue)}
                  note={`${count("WON")} clienți câștigați · RON`}
                  icon={Wallet}
                />
              </div>
              <div className="grid-two">
                <Panel
                  title="Parcursul prospectelor"
                  subtitle="Etapele atinse în parcursul de vânzare"
                  action={
                    <Link href="/analytics" className="text-link">
                      Vezi analizele{" "}
                      <ArrowUpRight size={13} style={{ display: "inline" }} />
                    </Link>
                  }
                >
                  <div className="funnel">
                    {[
                      ["Prospecte", leads.length],
                      ["Contactate", contacted.size],
                      ["Calificate", qualifiedReached.size],
                      ["Cu demo", demoReached.size],
                      ["Trial / checkout", trialReached.size],
                      ["Clienți", count("WON")],
                    ].map(([name, n], i) => (
                      <div className="funnel-col" key={name}>
                        <strong>{n}</strong>
                        <div className="funnel-bar">
                          <div
                            style={{
                              height: `${leads.length ? Math.max(3, (Number(n) / leads.length) * 100) : 3}%`,
                              animationDelay: `${i * 65}ms`,
                            }}
                          />
                        </div>
                        {name}
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel
                  title="Necesită atenția ta"
                  subtitle="Conversații pentru care un om face diferența"
                  action={
                    <span className="badge amber">
                      {count("HUMAN_REQUIRED")}
                    </span>
                  }
                >
                  {leads
                    .filter((l) => l.status === "HUMAN_REQUIRED")
                    .slice(0, 4)
                    .map((l) => (
                      <Link
                        className="list-row"
                        href={`/leads/${l.id}`}
                        key={l.id}
                      >
                        <div>
                          <strong>{l.company_name}</strong>
                          <small>
                            {l.conversation_summary ||
                              "Revizuiește conversația și alege următorul pas."}
                          </small>
                        </div>
                        <ChevronRight size={16} />
                      </Link>
                    ))}
                  {!count("HUMAN_REQUIRED") && (
                    <Empty
                      icon={CheckCircle2}
                      title="Totul este la zi"
                      text="Solicitările complexe vor fi trimise aici, pentru tine."
                    />
                  )}
                </Panel>
              </div>
              <div className="grid-two section-gap">
                <Panel
                  title="Următoarele automatizări"
                  subtitle="Acțiuni programate și procesate în siguranță"
                  action={
                    <Link className="text-link" href="/settings">
                      Vezi toate
                    </Link>
                  }
                >
                  {data.automation_jobs
                    .filter((j) => ["pending", "running"].includes(j.status))
                    .slice(0, 5)
                    .map((j) => (
                      <div className="list-row" key={j.id}>
                        <div className="row-main">
                          <span className="mini-avatar">
                            <Sparkles size={14} />
                          </span>
                          <div>
                            <strong>{jobNames[j.kind]}</strong>
                            <small>{leadName(j.lead_id)}</small>
                          </div>
                        </div>
                        <small>{dateTime(j.next_action_at)}</small>
                      </div>
                    ))}
                  {!data.automation_jobs.some((j) =>
                    ["pending", "running"].includes(j.status),
                  ) && (
                    <Empty
                      icon={Clock}
                      title="Nicio acțiune în așteptare"
                      text="Adaugă primul prospect pentru a începe analiza și pregătirea mesajelor."
                    />
                  )}
                </Panel>
                <Panel
                  title="Activitate recentă"
                  subtitle="Jurnalul echipei și al asistentului AI"
                >
                  {timeline(data.activities.slice(0, 5))}
                </Panel>
              </div>
              <div className="grid-equal section-gap">
                <Panel
                  title="Configurarea clienților"
                  subtitle={`${data.onboarding_records.length} formulare de onboarding`}
                >
                  {data.onboarding_records.slice(0, 4).map((o) => (
                    <div className="list-row" key={o.id}>
                      <div>
                        <strong>{leadName(o.lead_id)}</strong>
                        <small>{dateTime(o.created_at)}</small>
                      </div>
                      <Link
                        className="text-link"
                        href={`/onboarding/${o.share_token}`}
                      >
                        Deschide{" "}
                        <ArrowUpRight size={13} style={{ display: "inline" }} />
                      </Link>
                      <Badge value={o.status} />
                    </div>
                  ))}
                  {!data.onboarding_records.length && (
                    <Empty
                      icon={FileText}
                      title="Pregătit pentru primul client"
                      text="O plată confirmată creează automat formularul de configurare."
                    />
                  )}
                </Panel>
                <Panel
                  title="Pașii următori"
                  subtitle="De la primul prospect la prima conversație"
                >
                  <Link href="/leads" className="list-row">
                    <div className="row-main">
                      <span className="mini-avatar">1</span>
                      <div>
                        <strong>Adaugă prospectele potrivite</strong>
                        <small>Import CSV sau adăugare manuală</small>
                      </div>
                    </div>
                    <ChevronRight size={16} />
                  </Link>
                  <Link href="/settings/integrations" className="list-row">
                    <div className="row-main">
                      <span className="mini-avatar">2</span>
                      <div>
                        <strong>Configurează serviciile</strong>
                        <small>AI, email și voci pentru demonstrații</small>
                      </div>
                    </div>
                    <ChevronRight size={16} />
                  </Link>
                  <Link href="/campaigns" className="list-row">
                    <div className="row-main">
                      <span className="mini-avatar">3</span>
                      <div>
                        <strong>Pregătește prima campanie</strong>
                        <small>Revizuiește mesajele înainte de activare</small>
                      </div>
                    </div>
                    <ChevronRight size={16} />
                  </Link>
                </Panel>
              </div>
              <section id="notifications" className="section-gap">
                <h2 className="section-title">Notificări și rezumat zilnic</h2>
                {data.notifications.length ? (
                  data.notifications.slice(0, 5).map((n) => (
                    <div className="notification" key={n.id}>
                      <strong>{n.title}</strong>
                      <p>{n.body}</p>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Rezumatul zilnic apare la 18:30, ora Bucureștiului.
                  </p>
                )}
              </section>
            </>
          )}
          {section === "leads" && !leadId && (
            <>
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Caută prospecte"
                    placeholder="Caută după companie, contact, oraș sau email…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                  />
                </div>
                <span className="muted" style={{ fontSize: 13 }}>
                  {filtered.length} rezultate
                </span>
              </div>
              <div className="filters">
                <select
                  aria-label="Status"
                  value={filters.status || ""}
                  onChange={(e) => filter("status", e.target.value)}
                >
                  <option value="">Toate statusurile</option>
                  {statuses.map((s) => (
                    <option value={s} key={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </select>
                {(["niche", "city", "source"] as const).map((key) => (
                  <select
                    key={key}
                    aria-label={key}
                    value={filters[key] || ""}
                    onChange={(e) => filter(key, e.target.value)}
                  >
                    <option value="">
                      {key === "niche"
                        ? "Toate specialitățile"
                        : key === "city"
                          ? "Toate orașele"
                          : "Toate sursele"}
                    </option>
                    {options(key).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ))}
                <select
                  aria-label="Scor minim"
                  value={filters.score || ""}
                  onChange={(e) => filter("score", e.target.value)}
                >
                  <option value="">Orice scor</option>
                  <option value="50">50+ puncte</option>
                  <option value="80">80+ puncte</option>
                </select>
                <select
                  aria-label="Campanie"
                  value={filters.campaign || ""}
                  onChange={(e) => filter("campaign", e.target.value)}
                >
                  <option value="">Toate campaniile</option>
                  {data.campaigns.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Responsabil"
                  value={filters.owner || ""}
                  onChange={(e) => filter("owner", e.target.value)}
                >
                  <option value="">Toți responsabilii</option>
                  {data.profiles.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.full_name || p.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                {Object.values(filters).some(Boolean) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFilters({});
                      setPage(0);
                    }}
                  >
                    Resetează filtrele
                  </Button>
                )}
              </div>
              {selected.length > 0 && (
                <div className="selection">
                  <strong>{selected.length} selectate</strong>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !canEdit}
                    onClick={() => act("bulk_enrich", { ids: selected })}
                  >
                    Analizează cu AI
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !canEdit}
                    onClick={() => act("bulk_draft", { ids: selected })}
                  >
                    Generează mesaje
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy || !manager || selected.length > 10}
                    onClick={() =>
                      act("ai_evaluation_batch", { ids: selected })
                    }
                    title={
                      selected.length > 10
                        ? "Evaluarea controlată acceptă maximum 10 prospecte."
                        : "Generează două variante și le adaugă în coada de revizuire, fără trimitere."
                    }
                  >
                    Evaluare AI controlată
                  </Button>
                  <select
                    aria-label="Status în masă"
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                  >
                    {statuses.map((s) => (
                      <option value={s} key={s}>
                        {statusLabels[s]}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canEdit}
                    onClick={() =>
                      setConfirm({
                        title: "Schimbă statusul",
                        text: `Aplică „${statusLabels[bulkStatus]}” pentru ${selected.length} prospecte?`,
                        run: () =>
                          act("bulk_status", {
                            ids: selected,
                            status: bulkStatus,
                          }),
                      })
                    }
                  >
                    Aplică
                  </Button>
                  <select
                    aria-label="Alege campania"
                    value={bulkCampaign}
                    onChange={(e) => setBulkCampaign(e.target.value)}
                  >
                    <option value="">Alege campania</option>
                    {data.campaigns.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!bulkCampaign || !canEdit}
                    onClick={() =>
                      act("bulk_campaign", {
                        ids: selected,
                        campaign_id: bulkCampaign,
                      })
                    }
                  >
                    Asociază
                  </Button>
                  <Button
                    size="sm"
                    disabled={!bulkCampaign || !canEdit}
                    onClick={() =>
                      act("bulk_queue", {
                        ids: selected,
                        campaign_id: bulkCampaign,
                      })
                    }
                  >
                    Pregătește pentru campanie
                  </Button>
                </div>
              )}
              <div className="panel">
                <Table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Selectează pagina"
                          checked={
                            filtered.slice(page * 20, page * 20 + 20).length >
                              0 &&
                            filtered
                              .slice(page * 20, page * 20 + 20)
                              .every((l) => selected.includes(l.id))
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [
                                    ...new Set([
                                      ...selected,
                                      ...filtered
                                        .slice(page * 20, page * 20 + 20)
                                        .map((l) => l.id),
                                    ]),
                                  ]
                                : selected.filter(
                                    (id) =>
                                      !filtered
                                        .slice(page * 20, page * 20 + 20)
                                        .some((l) => l.id === id),
                                  ),
                            )
                          }
                        />
                      </th>
                      <th>Companie</th>
                      <th>Specialitate</th>
                      <th>Oraș</th>
                      <th>Scor AI</th>
                      <th>Status</th>
                      <th>Ultimul contact</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(page * 20, page * 20 + 20).map((l) => (
                      <tr key={l.id}>
                        <td>
                          <input
                            aria-label={`Selectează ${l.company_name}`}
                            type="checkbox"
                            checked={selected.includes(l.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, l.id]
                                  : selected.filter((id) => id !== l.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <Link href={`/leads/${l.id}`}>{l.company_name}</Link>
                          <small>
                            {l.email || l.website || "Contact de completat"}
                          </small>
                        </td>
                        <td>{l.niche || "Necunoscută"}</td>
                        <td>{l.city || "—"}</td>
                        <td>
                          <span className="score">
                            <span className="score-line">
                              <span
                                style={{ width: `${l.lead_score || 0}%` }}
                              />
                            </span>
                            {l.lead_score ?? "—"}
                          </span>
                        </td>
                        <td>
                          <Badge value={l.status} />
                        </td>
                        <td>
                          {l.last_contact_at
                            ? dateTime(l.last_contact_at)
                            : "Necontactat"}
                        </td>
                        <td>
                          <Link
                            href={`/leads/${l.id}`}
                            aria-label={`Deschide ${l.company_name}`}
                          >
                            <ChevronRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                {!filtered.length && (
                  <Empty
                    title={
                      leads.length
                        ? "Niciun rezultat"
                        : "Primul prospect, primul pas"
                    }
                    text={
                      leads.length
                        ? "Încearcă alte filtre sau un alt termen de căutare."
                        : "Adaugă o clinică sau importă un CSV. Datele vor fi analizate și organizate aici."
                    }
                  >
                    <Button
                      variant="secondary"
                      disabled={!canEdit}
                      onClick={() => open("lead")}
                    >
                      <Plus size={16} />
                      Adaugă prospect
                    </Button>
                  </Empty>
                )}
                <div className="table-footer">
                  <span>
                    {filtered.length
                      ? `${page * 20 + 1}–${Math.min(page * 20 + 20, filtered.length)}`
                      : "0"}{" "}
                    din {filtered.length} prospecte
                  </span>
                  <div className="actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft size={15} />
                      Înapoi
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={(page + 1) * 20 >= filtered.length}
                      onClick={() => setPage(page + 1)}
                    >
                      Înainte
                      <ChevronRight size={15} />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
          {selectedLead && (
            <>
              <Link href="/leads" className="text-link">
                ← Înapoi la prospecte
              </Link>
              <div className="detail-grid section-gap">
                <section className="panel detail-profile">
                  <div className="mini-avatar">
                    {selectedLead.company_name.slice(0, 1)}
                  </div>
                  <h2>{selectedLead.company_name}</h2>
                  <div className="pill-row" style={{ marginTop: 12 }}>
                    <Badge value={selectedLead.status} />
                    <span className="badge purple">
                      Scor {selectedLead.lead_score ?? "—"}/100
                    </span>
                  </div>
                  {[
                    ["Specialitate", selectedLead.niche],
                    [
                      "Oraș / țară",
                      [selectedLead.city, selectedLead.country]
                        .filter(Boolean)
                        .join(", "),
                    ],
                    ["Email", selectedLead.email],
                    ["Telefon", selectedLead.phone],
                    ["Website", selectedLead.website],
                    ["Persoană de contact", selectedLead.contact_name],
                    [
                      "Responsabil",
                      data.profiles.find((p) => p.id === selectedLead.owner_id)
                        ?.full_name,
                    ],
                    ["Sursă", selectedLead.source],
                    [
                      "Evaluare Google",
                      selectedLead.google_rating
                        ? `${selectedLead.google_rating} · ${selectedLead.review_count || 0} recenzii`
                        : null,
                    ],
                    [
                      "Program",
                      typeof selectedLead.opening_hours === "object" &&
                      selectedLead.opening_hours
                        ? String(
                            jsonObject(selectedLead.opening_hours).text ||
                              "Necunoscut",
                          )
                        : null,
                    ],
                    [
                      "Următoarea acțiune",
                      dateTime(selectedLead.next_action_at),
                    ],
                  ].map(([name, value]) => (
                    <dl className="detail-pair" key={name}>
                      <dt>{name}</dt>
                      <dd>{value || "Necunoscut"}</dd>
                    </dl>
                  ))}
                </section>
                <div>
                  <div className="tabs">
                    {[
                      ["overview", "Privire de ansamblu"],
                      ["conversation", "Conversație"],
                      ["activity", "Activitate"],
                      ["demo", "Demo-uri"],
                    ].map(([id, name]) => (
                      <button
                        key={id}
                        className={`tab ${tab === id ? "active" : ""}`}
                        onClick={() => setTab(id)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {tab === "overview" && (
                    <>
                      <Panel
                        title="Cercetare și analiză AI"
                        action={
                          <Badge
                            value={
                              selectedLead.enriched_at ? "ready" : "pending"
                            }
                          />
                        }
                      >
                        <div className="panel-body">
                          <p className="copy">
                            {selectedLead.website_summary ||
                              "Analiza va apărea după procesarea prospectului. Datele lipsă rămân marcate ca necunoscute."}
                          </p>
                          {selectedLead.personalization_fact && (
                            <div className="callout section-gap">
                              {selectedLead.personalization_fact}
                            </div>
                          )}
                          <div className="pill-row section-gap">
                            {Array.isArray(selectedLead.services) &&
                              selectedLead.services.map((s, i) => (
                                <span className="badge" key={i}>
                                  {String(s)}
                                </span>
                              ))}
                          </div>
                          {Array.isArray(selectedLead.score_reasons) &&
                            selectedLead.score_reasons.map((r, i) => (
                              <p className="copy" key={i}>
                                {String(jsonObject(r).reason || "")} · +
                                {String(jsonObject(r).points || 0)} puncte
                              </p>
                            ))}
                          <div className="section-gap">
                            {leadActions(selectedLead.id)}
                          </div>
                        </div>
                      </Panel>
                      {(() => {
                        const activity = data.activities.find(
                          (item) =>
                            item.lead_id === selectedLead.id &&
                            item.action === "ai_batch_evaluation",
                        );
                        if (!activity) return null;
                        const details = jsonObject(activity.details);
                        const flags = Array.isArray(details.flags)
                          ? details.flags.map(String)
                          : [];
                        return (
                          <Panel title="Evaluare controlată pentru revizuire">
                            <div className="panel-body">
                              <p className="copy">
                                {String(details.fit || "Evaluare indisponibilă.")}
                              </p>
                              <div className="pill-row section-gap">
                                <span className="badge purple">Varianta A</span>
                                <span className="badge">Varianta B</span>
                                <span className="badge green">
                                  ${Number(details.estimated_cost_usd || 0).toFixed(6)}
                                </span>
                                <span className="badge">
                                  {Number(details.total_tokens || 0)} tokenuri
                                </span>
                              </div>
                              {flags.length ? (
                                <div className="callout section-gap">
                                  <strong>De verificat înainte de contactare</strong>
                                  {flags.map((flag) => (
                                    <p className="copy" key={flag}>
                                      {flag}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                <p className="muted section-gap">
                                  Nu au fost detectate lipsuri sau duplicate.
                                </p>
                              )}
                            </div>
                          </Panel>
                        );
                      })()}
                      <Panel title="Notițe interne">
                        <form
                          className="panel-body"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            await act("lead_save", {
                              id: selectedLead.id,
                              lead: {
                                company_name: selectedLead.company_name,
                                country: selectedLead.country,
                                source: selectedLead.source,
                                notes: String(f.get("notes")),
                              },
                            });
                          }}
                        >
                          <textarea
                            name="notes"
                            defaultValue={selectedLead.notes}
                            placeholder="Context util pentru echipă…"
                          />
                          <Button
                            className="section-gap"
                            size="sm"
                            disabled={!canEdit || busy}
                          >
                            Salvează notițele
                          </Button>
                        </form>
                      </Panel>
                      <div className="actions section-gap">
                        <Button
                          variant="secondary"
                          disabled={!canEdit}
                          onClick={() =>
                            act("human", { ids: [selectedLead.id] })
                          }
                        >
                          Solicită intervenție umană
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={!canEdit}
                          onClick={() =>
                            act("bulk_status", {
                              ids: [selectedLead.id],
                              status: "WON",
                            })
                          }
                        >
                          Marchează câștigat
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={!canEdit}
                          onClick={() =>
                            setConfirm({
                              title: "Marchează pierdut",
                              text: "Prospectul va fi scos din fluxul activ de vânzare.",
                              run: () =>
                                act("bulk_status", {
                                  ids: [selectedLead.id],
                                  status: "LOST",
                                }),
                            })
                          }
                        >
                          Marchează pierdut
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!canEdit}
                          onClick={() =>
                            setConfirm({
                              title: "Oprește contactarea",
                              text: "Mesajele în așteptare și automatizările de contact vor fi oprite.",
                              run: () =>
                                act("suppress", { ids: [selectedLead.id] }),
                            })
                          }
                        >
                          Nu contacta
                        </Button>
                      </div>
                    </>
                  )}
                  {tab === "conversation" && (
                    <>
                      <div className="callout" style={{ marginBottom: 20 }}>
                        {selectedLead.conversation_summary ||
                          "Rezumatul va fi generat la primirea unui răspuns."}
                      </div>
                      {data.messages
                        .filter((m) => m.lead_id === selectedLead.id)
                        .slice()
                        .reverse()
                        .map(messageCard)}
                      {!data.messages.some(
                        (m) => m.lead_id === selectedLead.id,
                      ) && (
                        <Empty
                          icon={Mail}
                          title="Conversația nu a început încă"
                          text="Generează prima ciornă folosind informațiile verificate."
                        />
                      )}
                      {leadActions(selectedLead.id)}
                      <Button
                        variant="secondary"
                        className="section-gap"
                        disabled={!canEdit || !data.providers.stripe}
                        onClick={() => act("checkout", { id: selectedLead.id })}
                      >
                        Pregătește link de plată
                      </Button>
                    </>
                  )}
                  {tab === "activity" && (
                    <Panel title="Jurnalul prospectului">
                      {timeline(
                        data.activities.filter(
                          (a) => a.lead_id === selectedLead.id,
                        ),
                      )}
                    </Panel>
                  )}
                  {tab === "demo" && (
                    <>
                      <div className="actions" style={{ marginBottom: 22 }}>
                        <Button
                          disabled={!canEdit}
                          onClick={() =>
                            act("demo", { ids: [selectedLead.id] })
                          }
                        >
                          Generează demo
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={!canEdit}
                          onClick={() =>
                            act("send_demo", { ids: [selectedLead.id] })
                          }
                        >
                          Pregătește email cu demo
                        </Button>
                      </div>
                      {data.demos
                        .filter((d) => d.lead_id === selectedLead.id)
                        .map((d) => (
                          <div className="panel campaign-card" key={d.id}>
                            <Badge value={d.status} />
                            <h2>Demo pentru {selectedLead.company_name}</h2>
                            <p className="muted">{dateTime(d.created_at)}</p>
                            <Link
                              className="button secondary section-gap"
                              href={`/demo/${d.share_token}`}
                              target="_blank"
                            >
                              Deschide simularea
                              <ExternalLink size={14} />
                            </Link>
                          </div>
                        ))}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
          {section === "leads" && leadId && !selectedLead && (
            <Empty
              title="Prospect indisponibil"
              text="Prospectul nu există sau nu ai acces la el."
            />
          )}
          {section === "campaigns" && !campaignReviewId && (
            <>
              <div className="grid-three">
                {data.campaigns.map((c) => (
                  <div className="panel campaign-card" key={c.id}>
                    <div
                      className="actions"
                      style={{ justifyContent: "space-between" }}
                    >
                      <Badge value={c.status} />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editează ${c.name}`}
                        disabled={!manager}
                        onClick={() => open("campaign", c.id)}
                      >
                        <Ellipsis size={18} />
                      </Button>
                    </div>
                    <h2>{c.name}</h2>
                    <p className="muted" style={{ fontSize: 13 }}>
                      {c.niche || "Toate specialitățile"} ·{" "}
                      {c.cities.join(", ") || "Toate orașele"}
                    </p>
                    <div className="campaign-stats">
                      <div>
                        <strong>
                          {
                            data.campaign_leads.filter(
                              (l) => l.campaign_id === c.id,
                            ).length
                          }
                        </strong>
                        <small>Prospecte</small>
                      </div>
                      <div>
                        <strong>
                          {
                            data.messages.filter(
                              (m) => m.campaign_id === c.id && m.sent_at,
                            ).length
                          }
                        </strong>
                        <small>
                          {data.delivery === "log"
                            ? "Trimiteri simulate"
                            : "Mesaje trimise"}
                        </small>
                      </div>
                      <div>
                        <strong>{c.daily_cap}</strong>
                        <small>Limită zilnică</small>
                      </div>
                    </div>
                    <p className="muted" style={{ fontSize: 13 }}>
                      <Clock
                        size={13}
                        style={{ display: "inline", marginRight: 5 }}
                      />
                      {c.window_start.slice(0, 5)}–{c.window_end.slice(0, 5)} ·
                      București
                    </p>
                    <p className="muted" style={{ fontSize: 13, marginTop: 5 }}>
                      {c.mode === "automatic"
                        ? "Automată"
                        : "Aprobare înainte de trimitere"}{" "}
                      · maximum 2 reveniri
                    </p>
                    {c.name === "Evaluare controlată · revizuire ciorne" && (
                      <div className="callout section-gap">
                        <strong>Coada de revizuire</strong>
                        <p className="copy">
                          {
                            reviewActivities(c.id).length
                          }
                          /
                          {
                            data.campaign_leads.filter(
                              (item) => item.campaign_id === c.id,
                            ).length
                          }{" "}
                          evaluări complete ·{" "}
                          {
                            data.messages.filter(
                              (message) => {
                                const metadata = jsonObject(message.metadata);
                                return (
                                  message.campaign_id === c.id &&
                                  message.status === "draft" &&
                                  metadata.copy_version === outreachCopyVersion
                                );
                              },
                            ).length
                          }{" "}
                          ciorne · cost AI total estimat ${reviewActivities(c.id)
                            .reduce(
                              (sum, activity) =>
                                sum +
                                Number(
                                  jsonObject(activity.details)
                                    .estimated_cost_usd || 0,
                                ),
                              0,
                            )
                            .toFixed(6)}
                        </p>
                        <div className="pill-row section-gap">
                          {data.campaign_leads
                            .filter((item) => item.campaign_id === c.id)
                            .slice(0, 10)
                            .map((item) => (
                              <Link
                                className="badge"
                                href={`/leads/${item.lead_id}`}
                                key={item.id}
                              >
                                {leadName(item.lead_id)}
                              </Link>
                            ))}
                        </div>
                      </div>
                    )}
                    <div className="actions section-gap">
                      <Button asChild size="sm" variant="secondary">
                        <Link href={`/campaigns/${c.id}/review`}>
                          <FileText size={13} /> Review &amp; Launch
                        </Link>
                      </Button>
                      {c.status === "active" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!manager}
                          onClick={() =>
                            act("campaign_status", {
                              id: c.id,
                              status: "paused",
                            })
                          }
                        >
                          <Pause size={13} />
                          Pauză
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={
                            !manager ||
                            c.status === "archived" ||
                            c.name ===
                              "Evaluare controlată · revizuire ciorne"
                          }
                          onClick={() =>
                            setConfirm({
                              title: "Activează campania",
                              text:
                                data.delivery === "log"
                                  ? "Campania va procesa prospectele în modul local, fără emailuri reale."
                                  : "Campania va putea trimite emailuri reale în limitele configurate. Confirmă identitatea expeditorului și mesajele.",
                              run: () =>
                                act("campaign_status", {
                                  id: c.id,
                                  status: "active",
                                }),
                            })
                          }
                        >
                          <Play size={13} />
                          Activează
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!manager || c.status === "archived"}
                        onClick={() =>
                          setConfirm({
                            title: "Arhivează campania",
                            text: "Campania nu va mai trimite mesaje. Istoricul rămâne disponibil.",
                            run: () =>
                              act("campaign_status", {
                                id: c.id,
                                status: "archived",
                              }),
                          })
                        }
                      >
                        Arhivează
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {data.campaigns
                .filter(
                  (campaign) =>
                    campaign.name ===
                    "Evaluare controlată · revizuire ciorne",
                )
                .map((campaign) => (
                  <Panel
                    key={`${campaign.id}-review`}
                    title="Revizuire mesaje · Varianta B"
                    subtitle="Stilul principal pain-first. Toate mesajele rămân ciorne locale."
                  >
                    <Table>
                      <thead>
                        <tr>
                          <th>Prospect</th>
                          <th>Fapt folosit</th>
                          <th>Scor</th>
                          <th>Subiect</th>
                          <th>Ciornă</th>
                          <th>Cost estimat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reviewRows(campaign.id).map(
                          ({ lead, draft, activity }) => {
                            const metadata = jsonObject(draft?.metadata || null);
                            const details = jsonObject(
                              activity?.details || null,
                            );
                            return (
                              <tr key={lead?.id || draft?.lead_id}>
                                <td>
                                  {lead ? (
                                    <Link href={`/leads/${lead.id}`}>
                                      {lead.company_name}
                                    </Link>
                                  ) : (
                                    "Prospect indisponibil"
                                  )}
                                </td>
                                <td
                                  style={{
                                    whiteSpace: "normal",
                                    minWidth: 190,
                                    maxWidth: 280,
                                  }}
                                >
                                  {String(
                                    metadata.fact_used ||
                                      "Niciun fapt specific folosit",
                                  )}
                                </td>
                                <td>{lead?.lead_score ?? "—"}/100</td>
                                <td
                                  style={{
                                    whiteSpace: "normal",
                                    minWidth: 210,
                                  }}
                                >
                                  {draft?.subject || "În așteptare"}
                                </td>
                                <td
                                  style={{
                                    whiteSpace: "pre-wrap",
                                    minWidth: 360,
                                    maxWidth: 520,
                                    lineHeight: 1.55,
                                  }}
                                >
                                  {draft?.body ||
                                    "Se va genera când Gemini permite reluarea."}
                                </td>
                                <td>
                                  {activity
                                    ? `$${Number(
                                        details.estimated_cost_usd || 0,
                                      ).toFixed(6)}`
                                    : "—"}
                                </td>
                              </tr>
                            );
                          },
                        )}
                      </tbody>
                    </Table>
                  </Panel>
                ))}
              {!data.campaigns.length && (
                <div className="panel">
                  <Empty
                    icon={Send}
                    title="O conversație bună începe cu o campanie bună"
                    text="Alege audiența, ritmul de trimitere și mesajele. Tu decizi când pornește."
                  >
                    <Button
                      disabled={!manager}
                      onClick={() => open("campaign")}
                    >
                      <Plus size={16} />
                      Creează prima campanie
                    </Button>
                  </Empty>
                </div>
              )}
            </>
          )}
          {section === "campaigns" && campaignReviewId && (
            <CampaignReviewCenter
              data={data}
              campaignId={campaignReviewId}
              busy={busy}
              manager={manager}
              act={act}
            />
          )}
          {section === "inbox" && (
            <div className="panel inbox">
              <div className="inbox-list">
                {[...new Set(data.messages.map((m) => m.lead_id))].map((id) => (
                  <button
                    key={id}
                    className={`inbox-item ${(inboxLead || data.messages[0]?.lead_id) === id ? "active" : ""}`}
                    onClick={() => setInboxLead(id)}
                  >
                    <strong>{leadName(id)}</strong>
                    <small>
                      {data.messages
                        .find((m) => m.lead_id === id)
                        ?.body.slice(0, 90)}
                    </small>
                  </button>
                ))}
                {!data.messages.length && (
                  <Empty
                    icon={Inbox}
                    title="Nicio conversație"
                    text="Mesajele și ciornele vor apărea aici."
                  />
                )}
              </div>
              <div className="panel-body">
                {data.messages
                  .filter(
                    (m) =>
                      m.lead_id === (inboxLead || data.messages[0]?.lead_id),
                  )
                  .slice()
                  .reverse()
                  .map(messageCard)}
                {data.messages.length > 0 && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const f = new FormData(form);
                      const r = await act("message_reply", {
                        lead_id: inboxLead || data.messages[0].lead_id,
                        body: String(f.get("body")),
                      });
                      if (r) form.reset();
                    }}
                  >
                    <Area label="Răspuns manual" name="body" rows={4} />
                    <Button className="section-gap" disabled={!canEdit || busy}>
                      Salvează ciorna
                    </Button>
                  </form>
                )}
                {!data.messages.length && (
                  <Empty
                    icon={Mail}
                    title="Locul conversațiilor care contează"
                    text="Răspunsurile sunt asociate automat prospectelor. Mesajele sensibile sunt trimise către echipă."
                  />
                )}
              </div>
            </div>
          )}
          {section === "demos" && (
            <>
              <div className="grid-three">
                {data.demos.map((d) => (
                  <div key={d.id} className="panel campaign-card">
                    <AudioLines size={28} style={{ color: "#aa8cff" }} />
                    <h2>{leadName(d.lead_id)}</h2>
                    <p
                      className="muted"
                      style={{ fontSize: 13, margin: "8px 0 14px" }}
                    >
                      Simulare demonstrativă VoxaTech
                    </p>
                    <Badge value={d.status} />
                    <div className="campaign-stats">
                      <div>
                        <strong>{d.viewed_at ? "Da" : "—"}</strong>
                        <small>Vizualizat</small>
                      </div>
                      <div>
                        <strong>{d.listened_at ? "Da" : "—"}</strong>
                        <small>Ascultat</small>
                      </div>
                    </div>
                    <Link
                      className="button secondary"
                      href={`/demo/${d.share_token}`}
                      target="_blank"
                    >
                      <Play size={14} />
                      Deschide demo
                    </Link>
                  </div>
                ))}
              </div>
              {!data.demos.length && (
                <div className="panel">
                  <Empty
                    icon={AudioLines}
                    title="Fă experiența VoxaTech personală"
                    text="Deschide un prospect și generează o conversație demonstrativă pe baza serviciilor sale verificate."
                  >
                    <Link className="button secondary" href="/leads">
                      Alege un prospect
                      <ArrowUpRight size={15} />
                    </Link>
                  </Empty>
                </div>
              )}
            </>
          )}
          {section === "knowledge-base" && (
            <>
              <div className="grid-three">
                {data.knowledge_base_documents
                  .filter((d) => !d.deleted_at)
                  .map((d) => (
                    <div className="panel campaign-card" key={d.id}>
                      <div
                        className="actions"
                        style={{ justifyContent: "space-between" }}
                      >
                        <span className="badge purple">
                          {categoryLabels[d.category]}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          v{d.version}
                        </span>
                      </div>
                      <h2>{d.title}</h2>
                      <p
                        className="copy"
                        style={{
                          margin: "14px 0",
                          display: "-webkit-box",
                          WebkitLineClamp: 4,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {d.content}
                      </p>
                      <div className="actions">
                        <Badge value={d.active ? "active" : "paused"} />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!manager}
                          onClick={() => open("knowledge", d.id)}
                        >
                          Editează și vezi istoricul
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!manager}
                          onClick={() =>
                            setConfirm({
                              title: "Șterge documentul",
                              text: "Documentul va fi eliminat din baza activă. Versiunile anterioare rămân în jurnal.",
                              run: () => act("knowledge_delete", { id: d.id }),
                            })
                          }
                        >
                          Șterge
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
              {!data.knowledge_base_documents.some((d) => !d.deleted_at) && (
                <div className="panel">
                  <Empty
                    icon={BookOpen}
                    title="Baza de cunoștințe este goală"
                    text="Adaugă informațiile validate despre produs, prețuri și obiecții înainte de a procesa răspunsuri automate."
                  >
                    <Button
                      disabled={!manager}
                      onClick={() => open("knowledge")}
                    >
                      <Plus size={16} />
                      Adaugă primul document
                    </Button>
                  </Empty>
                </div>
              )}
            </>
          )}
          {section === "analytics" && (
            <>
              <div className="toolbar">
                <label className="field">
                  De la
                  <input
                    type="date"
                    value={range.from}
                    onChange={(e) =>
                      setRange({ ...range, from: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  Până la
                  <input
                    type="date"
                    value={range.to}
                    onChange={(e) => setRange({ ...range, to: e.target.value })}
                  />
                </label>
                <span className="muted" style={{ fontSize: 13 }}>
                  Cohortă după data adăugării prospectului
                </span>
              </div>
              <div className="metrics">
                <Metric
                  label="Total prospecte"
                  value={cohort.length}
                  note="În perioada selectată"
                />
                <Metric
                  label={
                    data.delivery === "log"
                      ? "Rată de contact simulată"
                      : "Rată de contact"
                  }
                  value={percent(contacted.size)}
                  note={`${contacted.size} prospecte ${data.delivery === "log" ? "procesate local" : "contactate"}`}
                />
                <Metric
                  label="Rată de răspuns"
                  value={percent(replied.size, contacted.size)}
                  note={`${replied.size} răspunsuri · raportat la contactate`}
                />
                <Metric
                  label="Rată de închidere"
                  value={percent(byStatus(cohort, "WON"))}
                  note={`${byStatus(cohort, "WON")} clienți`}
                />
                <Metric
                  label="Calificare"
                  value={percent(reachedInCohort(qualifiedReached))}
                  note="Prospecte care au atins etapa de calificare"
                />
                <Metric
                  label="Demo-uri"
                  value={percent(reachedInCohort(demoReached))}
                  note="Prospecte cu demo generat"
                />
                <Metric
                  label="Testare"
                  value={percent(reachedInCohort(trialReached))}
                  note="Prospecte ajunse la trial sau checkout"
                />
                <Metric
                  label="Venit câștigat"
                  value={money(
                    cohort.reduce(
                      (n, l) => n + (l.currency === "RON" ? l.revenue_won : 0),
                      0,
                    ),
                  )}
                  note="Doar venituri în RON"
                  icon={Wallet}
                />
              </div>
              <div className="grid-equal">
                <Panel
                  title="Specialități cu potențial"
                  subtitle="Distribuție prospecte"
                >
                  {" "}
                  <div className="panel-body">
                    {topGroup("niche").map(([name, n]) => (
                      <div className="chart-row" key={name}>
                        <span>{name}</span>
                        <div className="chart-track">
                          <span
                            style={{
                              width: `${(n / Math.max(1, cohort.length)) * 100}%`,
                            }}
                          />
                        </div>
                        <strong>{n}</strong>
                      </div>
                    ))}
                    {!cohort.length && (
                      <Empty
                        icon={ChartNoAxesCombined}
                        title="Datele vor spune povestea"
                        text="Adaugă prospecte pentru a compara specialitățile."
                      />
                    )}
                  </div>
                </Panel>
                <Panel
                  title="Distribuție pe orașe"
                  subtitle="Audiența ta, în cifre"
                >
                  <div className="panel-body">
                    {topGroup("city").map(([name, n]) => (
                      <div className="chart-row" key={name}>
                        <span>{name}</span>
                        <div className="chart-track">
                          <span
                            style={{
                              width: `${(n / Math.max(1, cohort.length)) * 100}%`,
                            }}
                          />
                        </div>
                        <strong>{n}</strong>
                      </div>
                    ))}
                    {!cohort.length && (
                      <Empty
                        icon={Globe}
                        title="Nicio regiune încă"
                        text="Orașele apar după adăugarea sau analiza prospectelor."
                      />
                    )}
                  </div>
                </Panel>
              </div>
              <div className="section-gap">
                <Panel title="Performanța campaniilor">
                  <Table>
                    <thead>
                      <tr>
                        <th>Campanie</th>
                        <th>Prospecte</th>
                        <th>Trimise</th>
                        <th>Deschise</th>
                        <th>Răspunsuri</th>
                        <th>Câștigate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.campaigns.map((c) => {
                        const cl = data.campaign_leads
                          .filter(
                            (l) => l.campaign_id === c.id && ids.has(l.lead_id),
                          )
                          .map((l) => l.lead_id);
                        const cm = cohortMessages.filter(
                          (m) => m.campaign_id === c.id,
                        );
                        return (
                          <tr key={c.id}>
                            <td>{c.name}</td>
                            <td>{cl.length}</td>
                            <td>{cm.filter((m) => m.sent_at).length}</td>
                            <td>
                              {cm.filter((m) => m.status === "opened").length}
                            </td>
                            <td>
                              {
                                [...replied].filter((id) => cl.includes(id))
                                  .length
                              }
                            </td>
                            <td>
                              {
                                cohort.filter(
                                  (l) =>
                                    cl.includes(l.id) && l.status === "WON",
                                ).length
                              }
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </Panel>
              </div>
              <div className="metrics section-gap">
                <Metric
                  label="Cost AI estimat / prospect"
                  value={
                    pricedActivities.length
                      ? money(estimated / Math.max(1, cohort.length), "USD")
                      : "Neconfigurat"
                  }
                  note="Pe baza tokenurilor și costului din Setări"
                />
                <Metric
                  label="Cost AI estimat / client"
                  value={
                    pricedActivities.length
                      ? money(
                          estimated / Math.max(1, byStatus(cohort, "WON")),
                          "USD",
                        )
                      : "Neconfigurat"
                  }
                  note="Exclude email, voce și costurile comerciale"
                />
                <Metric
                  label="Timp mediu până la demo"
                  value={(() => {
                    const values = data.demos
                      .filter((d) => ids.has(d.lead_id))
                      .map(
                        (d) =>
                          (new Date(d.created_at).getTime() -
                            new Date(
                              cohort.find((l) => l.id === d.lead_id)!
                                .created_at,
                            ).getTime()) /
                          86400000,
                      );
                    return values.length
                      ? `${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} zile`
                      : "—";
                  })()}
                  note="De la creare la primul demo disponibil"
                />
                <Metric
                  label="Demo → client"
                  value={(() => {
                    const values = data.onboarding_records
                      .filter((o) => ids.has(o.lead_id))
                      .flatMap((o) => {
                        const d = data.demos.find(
                          (d) => d.lead_id === o.lead_id,
                        );
                        return d
                          ? [
                              (new Date(o.created_at).getTime() -
                                new Date(d.created_at).getTime()) /
                                86400000,
                            ]
                          : [];
                      });
                    return values.length
                      ? `${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} zile`
                      : "—";
                  })()}
                  note="Pe baza plăților confirmate"
                />
              </div>
              <Panel title="Variante de mesaje">
                <Table>
                  <thead>
                    <tr>
                      <th>Variantă</th>
                      <th>Trimise</th>
                      <th>Deschise</th>
                      <th>Răspunsuri asociate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 1, 2].map((step) => {
                      const messages = cohortMessages.filter(
                        (m) => m.follow_up_number === step && m.sent_at,
                      );
                      return (
                        <tr key={step}>
                          <td>{step ? `Revenire ${step}` : "Primul mesaj"}</td>
                          <td>{messages.length}</td>
                          <td>
                            {
                              messages.filter((m) => m.status === "opened")
                                .length
                            }
                          </td>
                          <td>
                            {
                              messages.filter((m) => replied.has(m.lead_id))
                                .length
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Panel>
            </>
          )}
          {path === "settings/integrations" && (
            <>
              <div className="grid-equal">
                {[
                  [
                    "supabase",
                    "Supabase",
                    "Bază de date, autentificare și fișiere private.",
                  ],
                  [
                    "google_gemini",
                    "Google Gemini",
                    "Analiză structurată, mesaje și asistent de vânzări prin SDK-ul Google GenAI.",
                  ],
                  [
                    "resend",
                    "Resend",
                    "Emailuri, evenimente de livrare și răspunsuri.",
                  ],
                  [
                    "elevenlabs",
                    "ElevenLabs",
                    "Două voci pentru conversațiile demonstrative.",
                  ],
                  [
                    "stripe",
                    "Stripe",
                    "Plăți și pornirea configurării clientului.",
                  ],
                  [
                    "whatsapp",
                    "WhatsApp",
                    "Adaptor pregătit. Necesită integrare și fluxuri aprobate.",
                  ],
                ].map(([id, name, description]) => (
                  <div key={id} className="panel integration">
                    <span className="provider-icon">{name.slice(0, 1)}</span>
                    <div style={{ flex: 1 }}>
                      <h2>{name}</h2>
                      <p
                        className="muted"
                        style={{ fontSize: 13, marginBottom: 14 }}
                      >
                        {description}
                      </p>
                      <span
                        className={`badge ${data.providers[id] ? "green" : ""}`}
                      >
                        {id === "supabase"
                          ? "Conexiune verificată"
                          : id === "google_gemini" && geminiHealthy
                            ? `Conexiune verificată · ${String(jsonObject(geminiIntegration?.public_config || {}).model || "gemini-3.8-flash")}`
                            : id === "google_gemini" && data.providers[id]
                              ? "Cheie detectată · test de sănătate necesar"
                              : id === "resend" &&
                                  data.providers[id] &&
                                  resendConfig.sender_domain_verified === true
                                ? `Domeniu verificat · ${String(resendConfig.sender_domain || "Resend")}`
                                : id === "resend" && data.providers[id]
                                  ? "Configurație detectată · verifică domeniul"
                              : data.providers[id]
                                ? "Chei configurate · verifică înainte de utilizare"
                                : "Neconfigurat"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="panel panel-body section-gap">
                <h2>Configurare în siguranță</h2>
                <p className="copy section-gap">
                  Cheile se configurează exclusiv pe server, în fișierul de
                  mediu sau în Vercel. Nu le introduce în documente, notițe ori
                  mesaje. După configurare, repornește aplicația și verifică
                  fiecare serviciu cu un test controlat.
                </p>
                <p className="copy section-gap">
                  Email:{" "}
                  {data.delivery === "live"
                    ? "mod live — necesită și o campanie activă"
                    : "mod local — trimiterile sunt simulate și marcate clar; nu se trimit emailuri"}
                  . WhatsApp rămâne neconfigurat până la implementarea unui
                  furnizor și verificarea permisiunilor de conversație.
                </p>
              </div>
              <div className="section-gap">
                <Panel
                  title="Șabloane WhatsApp"
                  subtitle="Ciorne interne. Trimiterea necesită un furnizor conectat și aprobarea șablonului."
                >
                  <div className="panel-body">
                    {data.settings
                      .filter((s) => s.key.startsWith("whatsapp_template:"))
                      .map((s) => (
                        <div className="message" key={s.id}>
                          <h3>
                            {String(jsonObject(s.value).name || "Șablon")}
                          </h3>
                          <p className="copy">
                            {String(jsonObject(s.value).body || "")}
                          </p>
                          <span className="badge section-gap">
                            În așteptarea aprobării furnizorului
                          </span>
                        </div>
                      ))}
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const input = Object.fromEntries(new FormData(form));
                        if (await act("whatsapp_template", input)) form.reset();
                      }}
                    >
                      <div className="form-grid">
                        <Field label="Nume șablon" name="name" required />
                        <label className="field">
                          Flux permis
                          <select name="flow">
                            <option value="user_initiated">
                              Conversație inițiată de prospect
                            </option>
                            <option value="opt_in">
                              Consimțământ explicit înregistrat
                            </option>
                          </select>
                        </label>
                        <Area label="Mesaj în română" name="body" rows={3} />
                      </div>
                      <Button
                        className="section-gap"
                        variant="secondary"
                        disabled={!manager || busy}
                      >
                        Salvează ciorna șablonului
                      </Button>
                    </form>
                  </div>
                </Panel>
              </div>
            </>
          )}
          {path === "settings" && (
            <>
              <div className="settings-grid">
                <Panel
                  title="Asistentul AI"
                  subtitle="Modele și instrucțiuni pentru întreaga organizație"
                >
                  <form
                    className="panel-body"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      await act("settings_save", {
                        provider: String(f.get("provider")),
                        model: String(f.get("model")),
                        prompt: String(f.get("prompt")),
                        input_cost_per_million: Number(f.get("input_cost")),
                        output_cost_per_million: Number(f.get("output_cost")),
                      });
                    }}
                  >
                    <div className="form-grid">
                      <label className="field">
                        Furnizor AI
                        <select name="provider" defaultValue="google_gemini">
                          <option value="google_gemini">Google Gemini</option>
                        </select>
                      </label>
                      <Field
                        label="Model pentru toate fluxurile AI"
                        name="model"
                        defaultValue={String(
                          jsonObject(
                            data.settings.find((s) => s.key === "ai_models")
                              ?.value || {},
                          ).default || "gemini-3.8-flash",
                        )}
                        required
                      />
                      <Field
                        label="Cost intrare USD / 1 milion tokenuri"
                        name="input_cost"
                        type="number"
                        step="0.01"
                        defaultValue={Number(costs.input_per_million ?? 0.75)}
                      />
                      <Area
                        label="Instrucțiuni interne"
                        name="prompt"
                        value={String(
                          data.settings.find(
                            (s) => s.key === "ai_system_prompt",
                          )?.value || "",
                        )}
                        rows={9}
                      />
                      <Field
                        label="Cost ieșire USD / 1 milion tokenuri"
                        name="output_cost"
                        type="number"
                        step="0.01"
                        defaultValue={Number(costs.output_per_million ?? 3.75)}
                      />
                    </div>
                    <p className="muted section-gap" style={{ fontSize: 13 }}>
                      Nivelul de gândire este „low” pentru automatizările de
                      volum și „medium” pentru conversații, obiecții și scenarii
                      demo. Regulile de siguranță sunt aplicate independent de
                      acest text.
                    </p>
                    <Button className="section-gap" disabled={!manager || busy}>
                      Salvează setările
                    </Button>
                  </form>
                </Panel>
                <div>
                  <Panel title="Contul tău">
                    <div className="panel-body">
                      <p>{data.user.email}</p>
                      <span className="badge purple section-gap">
                        {roleNames[data.user.role]}
                      </span>
                      <form
                        className="section-gap"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const form = e.currentTarget;
                          const f = new FormData(form);
                          if (
                            await act("password", {
                              password: String(f.get("password")),
                            })
                          )
                            form.reset();
                        }}
                      >
                        <Field
                          label="Parolă nouă · minimum 12 caractere"
                          name="password"
                          type="password"
                          required
                        />
                        <Button
                          className="section-gap"
                          variant="secondary"
                          disabled={busy}
                        >
                          Schimbă parola
                        </Button>
                      </form>
                    </div>
                  </Panel>
                  <div className="section-gap">
                    <Panel title="Echipa VoxaTech">
                      <div>
                        {data.profiles.map((p) => (
                          <div className="list-row" key={p.id}>
                            <div className="row-main">
                              <span className="mini-avatar">
                                {p.full_name?.slice(0, 1) || "V"}
                              </span>
                              <strong>{p.full_name || "Membru echipă"}</strong>
                            </div>
                            {p.id === data.user.id && (
                              <span className="badge">Tu</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </Panel>
                  </div>
                </div>
              </div>
              <div className="section-gap">
                <Panel
                  title="Centrul de automatizări"
                  subtitle="Reîncercări, erori și istoricul procesării"
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!manager || busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await fetch("/api/worker", {
                            method: "POST",
                          });
                          if (!r.ok) throw new Error();
                          await refresh();
                          tell(
                            "Procesarea s-a încheiat. Verifică rezultatele în jurnal.",
                          );
                        } catch {
                          tell("Procesarea nu a putut fi finalizată.");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Play size={14} />
                      Procesează acum
                    </Button>
                  }
                >
                  <Table>
                    <thead>
                      <tr>
                        <th>Acțiune</th>
                        <th>Prospect</th>
                        <th>Status</th>
                        <th>Încercări</th>
                        <th>Programată</th>
                        <th>Detalii</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.automation_jobs.slice(0, 100).map((j) => (
                        <tr key={j.id}>
                          <td>{jobNames[j.kind]}</td>
                          <td>{leadName(j.lead_id)}</td>
                          <td>
                            <Badge value={j.status} />
                          </td>
                          <td>
                            {j.attempts}/{j.max_attempts}
                          </td>
                          <td>{dateTime(j.next_action_at)}</td>
                          <td style={{ maxWidth: 280, whiteSpace: "normal" }}>
                            {j.last_error || "—"}
                          </td>
                          <td>
                            {["failed", "completed"].includes(j.status) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!manager}
                                onClick={() => act("retry_job", { id: j.id })}
                              >
                                Reîncearcă
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  {!data.automation_jobs.length && (
                    <Empty
                      icon={Clock}
                      title="Nicio automatizare încă"
                      text="Acțiunile vor apărea după adăugarea prospectelor."
                    />
                  )}
                </Panel>
              </div>
              <div className="section-gap">
                <Panel title="Sarcinile echipei">
                  {data.tasks
                    .filter((t) => t.status !== "completed")
                    .map((t) => (
                      <div className="list-row" key={t.id}>
                        <div>
                          <strong>{t.title}</strong>
                          <small>
                            {leadName(t.lead_id)} · {t.description}
                          </small>
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!canEdit}
                          onClick={() => act("task_complete", { id: t.id })}
                        >
                          Finalizează
                        </Button>
                      </div>
                    ))}
                  {!data.tasks.some((t) => t.status !== "completed") && (
                    <Empty
                      icon={CheckCircle2}
                      title="Nicio sarcină deschisă"
                      text="Solicitările care necesită intervenție vor apărea aici."
                    />
                  )}
                </Panel>
              </div>
            </>
          )}
        </div>
      </main>
      <Modal
        open={modal === "lead"}
        onOpenChange={() => setModal(null)}
        title={editLead ? "Editează prospectul" : "Prospect nou"}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const input = Object.fromEntries(f);
            const r = await act("lead_save", {
              id: edit || undefined,
              lead: { ...input, owner_id: input.owner_id || null },
            });
            if (r) setModal(null);
          }}
        >
          <div className="form-grid">
            <Field
              label="Numele clinicii *"
              name="company_name"
              defaultValue={editLead?.company_name}
              required
            />
            <Field
              label="Specialitate"
              name="niche"
              defaultValue={editLead?.niche || ""}
            />
            <Field
              label="Oraș"
              name="city"
              defaultValue={editLead?.city || ""}
            />
            <Field
              label="Țară (cod ISO)"
              name="country"
              defaultValue={editLead?.country || "RO"}
            />
            <Field
              label="Website"
              name="website"
              type="url"
              defaultValue={editLead?.website || ""}
            />
            <Field
              label="Email"
              name="email"
              type="email"
              defaultValue={editLead?.email || ""}
            />
            <Field
              label="Telefon"
              name="phone"
              defaultValue={editLead?.phone || ""}
            />
            <Field
              label="Persoană de contact"
              name="contact_name"
              defaultValue={editLead?.contact_name || ""}
            />
            <Field
              label="Sursă"
              name="source"
              defaultValue={editLead?.source || "manual"}
            />
            <label className="field">
              Responsabil
              <select name="owner_id" defaultValue={editLead?.owner_id || ""}>
                <option value="">Neasignat</option>
                {data.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <Area label="Notițe" name="notes" value={editLead?.notes || ""} />
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModal(null)}
            >
              Anulează
            </Button>
            <Button disabled={busy}>Salvează prospectul</Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={modal === "campaign"}
        onOpenChange={() => setModal(null)}
        title={editCampaign ? "Editează campania" : "Campanie nouă"}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const v = Object.fromEntries(f);
            const r = await act("campaign_save", {
              id: edit || undefined,
              campaign: {
                ...v,
                cities: String(v.cities)
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                daily_cap: Number(v.daily_cap),
                target_filters: {
                  min_score: String(v.min_score || "0"),
                  source: String(v.target_source || ""),
                },
              },
            });
            if (r) setModal(null);
          }}
        >
          <div className="form-grid">
            <Field
              label="Numele campaniei *"
              name="name"
              defaultValue={editCampaign?.name}
              required
            />
            <Field
              label="Specialitate"
              name="niche"
              defaultValue={editCampaign?.niche || ""}
            />
            <Field
              label="Orașe · separate prin virgulă"
              name="cities"
              defaultValue={editCampaign?.cities.join(", ") || ""}
            />
            <Field
              label="Email expeditor verificat *"
              name="sender_identity"
              type="email"
              defaultValue={editCampaign?.sender_identity || ""}
              required
            />
            <Field
              label="Scor AI minim"
              name="min_score"
              type="number"
              defaultValue={String(
                jsonObject(editCampaign?.target_filters || {}).min_score || "0",
              )}
            />
            <Field
              label="Sursă prospecte · opțional"
              name="target_source"
              defaultValue={String(
                jsonObject(editCampaign?.target_filters || {}).source || "",
              )}
            />
            <Field
              label="Tonul mesajelor"
              name="tone"
              defaultValue={editCampaign?.tone || "profesional, natural"}
            />
            <Field
              label="Limită zilnică"
              name="daily_cap"
              type="number"
              defaultValue={editCampaign?.daily_cap || 25}
            />
            <Field
              label="Început · București"
              name="window_start"
              type="time"
              defaultValue={editCampaign?.window_start.slice(0, 5) || "09:30"}
            />
            <Field
              label="Sfârșit · București"
              name="window_end"
              type="time"
              defaultValue={editCampaign?.window_end.slice(0, 5) || "16:30"}
            />
            <label className="field full">
              Mod de trimitere
              <select
                name="mode"
                defaultValue={editCampaign?.mode || "approval_required"}
              >
                <option value="approval_required">
                  Aprobare înainte de trimitere
                </option>
                <option value="automatic">
                  Automat · numai după activarea campaniei
                </option>
              </select>
            </label>
            <Area
              label="Oferta"
              name="offer"
              value={
                editCampaign?.offer ||
                "Recepționer AI VoxaTech pentru preluarea apelurilor și programări."
              }
              rows={3}
            />
            <Area
              label="Direcție pentru primul mesaj"
              name="first_message"
              value={
                editCampaign?.first_message ||
                "O observație verificată despre clinică. O întrebare despre apelurile din afara programului."
              }
              rows={3}
            />
            <Area
              label="Revenire 1"
              name="follow_up_1"
              value={
                editCampaign?.follow_up_1 ||
                "O revenire scurtă, utilă, fără presiune."
              }
              rows={2}
            />
            <Area
              label="Revenire 2"
              name="follow_up_2"
              value={
                editCampaign?.follow_up_2 ||
                "Ultima revenire. Oferă opțiunea clară de a opri conversația."
              }
              rows={2}
            />
          </div>
          <p className="muted section-gap" style={{ fontSize: 13 }}>
            Doar în zilele lucrătoare. Maximum două reveniri. O pauză aleatorie
            de 1–3 minute între mesaje.
          </p>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModal(null)}
            >
              Anulează
            </Button>
            <Button disabled={busy}>Salvează campania</Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={modal === "knowledge"}
        onOpenChange={() => setModal(null)}
        title={editKnowledge ? "Editează documentul" : "Document nou"}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const r = await act("knowledge_save", {
              id: edit || undefined,
              title: String(f.get("title")),
              category: String(f.get("category")),
              content: String(f.get("content")),
              active: f.get("active") === "on",
            });
            if (r) setModal(null);
          }}
        >
          <div className="form-grid">
            <Field
              label="Titlu"
              name="title"
              defaultValue={editKnowledge?.title}
              required
            />
            <label className="field">
              Categorie
              <select
                name="category"
                defaultValue={editKnowledge?.category || "product"}
              >
                {categories.map((c) => (
                  <option value={c} key={c}>
                    {categoryLabels[c]}
                  </option>
                ))}
              </select>
            </label>
            <Area
              label="Conținut verificat"
              name="content"
              value={editKnowledge?.content || ""}
              rows={12}
            />
            <label className="actions">
              <input
                name="active"
                type="checkbox"
                defaultChecked={editKnowledge?.active ?? true}
              />
              Document activ pentru AI
            </label>
          </div>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModal(null)}
            >
              Anulează
            </Button>
            <Button disabled={busy}>Salvează versiunea</Button>
          </div>
        </form>
        {editKnowledge && (
          <>
            <h3 className="section-title">Istoric versiuni</h3>
            {data.knowledge_base_versions
              .filter((v) => v.document_id === editKnowledge.id)
              .map((v) => (
                <details key={v.id} style={{ marginBottom: 12 }}>
                  <summary>
                    Versiunea {v.version} · {dateTime(v.created_at)}
                  </summary>
                  <p className="copy section-gap">{v.content}</p>
                </details>
              ))}
          </>
        )}
      </Modal>
      <ImportDialog
        open={modal === "import"}
        close={() => setModal(null)}
        onImport={(rows) => act("import", rows)}
      />
      <Modal
        open={!!confirm}
        onOpenChange={() => setConfirm(null)}
        title={confirm?.title || "Confirmare"}
      >
        <p className="copy">{confirm?.text}</p>
        <div className="form-actions">
          <Button variant="secondary" onClick={() => setConfirm(null)}>
            Anulează
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (confirm && (await confirm.run())) setConfirm(null);
            }}
          >
            Confirmă
          </Button>
        </div>
      </Modal>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
