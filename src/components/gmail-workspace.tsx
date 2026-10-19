"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowLeft,
  Check,
  ChevronRight,
  Inbox,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import type { Snapshot } from "@/lib/snapshot";
import { approvedOutreachTemplate } from "@/lib/outreach-template";
import { validProspectEmail } from "@/lib/launch";
import { dateTime, sendingWindow } from "@/lib/domain";
import { inboxConversations } from "@/lib/gmail-inbox";

type Props = { data: Snapshot; manager: boolean; refresh: () => Promise<void> };
const statusLabel: Record<string, string> = {
  connected: "Conectată",
  paused: "În pauză",
  reconnect_required: "Reconectare necesară",
  disconnected: "Deconectată",
};
const messageStatusLabel: Record<string, string> = {
  draft: "Ciornă",
  approved: "Aprobat",
  queued: "Programat",
  sending: "În curs de trimitere",
  sent: "Trimis",
  delivered: "Livrat",
  opened: "Deschis",
  received: "Primit",
  cancelled: "Oprit",
  failed: "Eroare",
  bounced: "Respins de server",
};
async function request(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Acțiunea nu a putut fi finalizată.");
  return result;
}
function metadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function GmailAccountsPanel({ data, manager, refresh }: Props) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [limits, setLimits] = useState<Record<string, number>>({}),
    [disconnect, setDisconnect] = useState<string | null>(null),
    [testAccount, setTestAccount] = useState<string | null>(null);
  const oauthStatus = useSearchParams().get("gmail");
  const displayedNotice =
    notice ||
    (oauthStatus === "connected"
      ? "Căsuța Gmail a fost conectată."
      : oauthStatus === "failed"
        ? "Conectarea nu s-a finalizat. Încearcă din nou și acordă accesul la trimitere și citire."
        : "");
  async function act(action: string, id?: string) {
    setBusy(true);
    setNotice("");
    try {
      if (action === "connect") {
        const result = await request("/api/gmail/connect", {});
        window.location.assign(result.url);
        return;
      }
      await request(
        "/api/gmail/accounts",
        action === "limit"
          ? {
              action,
              id,
              daily_cap:
                limits[id!] ||
                data.gmail_accounts.find((a) => a.id === id)?.daily_cap,
            }
          : { action, id },
      );
      await refresh();
      setTestAccount(null);
      setNotice(
        action === "limit"
          ? "Limita a fost salvată."
          : action === "test"
            ? "Testul Gmail a fost trimis la adresa internă configurată."
            : "Căsuța a fost deconectată.",
      );
      setDisconnect(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Acțiune nereușită.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="gmail-accounts panel">
      <div className="gmail-section-head">
        <div>
          <h2>Căsuțele tale Gmail</h2>
          <p>Un expeditor real pentru fiecare conversație.</p>
        </div>
        <Button
          variant="secondary"
          disabled={!manager || busy || !data.providers.gmail}
          onClick={() => act("connect")}
        >
          <Plus size={16} aria-hidden="true" />
          Conectează Gmail
        </Button>
      </div>
      {displayedNotice && (
        <p role="status" className="gmail-notice">
          {displayedNotice}
        </p>
      )}
      {!data.providers.gmail && (
        <p className="gmail-notice">
          Conectarea Google trebuie configurată înainte de a adăuga căsuțe.
        </p>
      )}
      {data.gmail_accounts.length ? (
        <div className="gmail-mailbox-list">
          {data.gmail_accounts.map((account) => (
            <div className="gmail-mailbox-row" key={account.id}>
              <span className="gmail-avatar">
                <Mail size={18} aria-hidden="true" />
              </span>
              <div className="gmail-mailbox-name">
                <strong>{account.email}</strong>
                <small>
                  <span
                    className={`gmail-dot ${account.status === "connected" ? "on" : ""}`}
                  />
                  {statusLabel[account.status]}
                  {account.last_synced_at
                    ? ` · Actualizată ${dateTime(account.last_synced_at)}`
                    : " · Prima sincronizare în așteptare"}
                </small>
                {account.last_error && (
                  <p className="gmail-mailbox-error">{account.last_error}</p>
                )}
              </div>
              <div className="gmail-mailbox-usage">
                <strong>
                  {data.gmail_today[account.id] || 0}
                  <span> / {account.daily_cap}</span>
                </strong>
                <small>trimiteri rezervate azi</small>
              </div>
              <label className="gmail-limit">
                Limită / zi
                <input
                  aria-label={`Limită zilnică pentru ${account.email}`}
                  type="number"
                  min="1"
                  max="10"
                  value={limits[account.id] ?? account.daily_cap}
                  disabled={!manager || busy}
                  onChange={(e) =>
                    setLimits({
                      ...limits,
                      [account.id]: Number(e.target.value),
                    })
                  }
                />
              </label>
              <div className="actions">
                {account.status === "connected" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      !manager ||
                      busy ||
                      (data.gmail_today[account.id] || 0) >= account.daily_cap
                    }
                    onClick={() => setTestAccount(account.id)}
                  >
                    {account.last_test_at
                      ? "Repetă testul"
                      : "Trimite test intern"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    !manager ||
                    busy ||
                    limits[account.id] === undefined ||
                    limits[account.id] === account.daily_cap ||
                    limits[account.id] < 1 ||
                    limits[account.id] > 10
                  }
                  onClick={() => act("limit", account.id)}
                >
                  Salvează
                </Button>
                {account.status !== "connected" &&
                account.status !== "disconnected" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!manager || busy}
                    onClick={() => act("connect")}
                  >
                    Reconectează
                  </Button>
                ) : (
                  account.status !== "disconnected" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!manager || busy}
                      onClick={() => setDisconnect(account.id)}
                    >
                      Deconectează
                    </Button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="gmail-empty">
          <Mail size={26} aria-hidden="true" />
          <h3>Începe cu o căsuță Gmail</h3>
          <p>
            Conectează contul prin Google. Adaugă apoi celelalte căsuțe din
            același loc.
          </p>
        </div>
      )}
      <p className="gmail-footnote">
        <ShieldCheck size={15} aria-hidden="true" />
        10 trimiteri pe zi implicit, maximum 10. Testele și toate campaniile
        împart aceeași limită; aceasta nu garantează livrarea în inbox.
      </p>
      <Modal
        open={!!testAccount}
        onOpenChange={(open) => !open && setTestAccount(null)}
        title="Trimite un test Gmail"
      >
        <p>
          Trimite un email real din această căsuță exclusiv la adresa internă
          configurată. Testul intră în limita zilnică; niciun lead nu este
          contactat.
        </p>
        <div className="actions section-gap">
          <Button variant="secondary" onClick={() => setTestAccount(null)}>
            Renunță
          </Button>
          <Button disabled={busy} onClick={() => act("test", testAccount!)}>
            Trimite testul
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!disconnect}
        onOpenChange={(open) => !open && setDisconnect(null)}
        title="Deconectează căsuța Gmail"
      >
        <p>
          Trimiterile acestei căsuțe se opresc. Mesajele deja importate rămân în
          dashboard.
        </p>
        <div className="actions section-gap">
          <Button variant="secondary" onClick={() => setDisconnect(null)}>
            Renunță
          </Button>
          <Button
            disabled={busy}
            onClick={() => act("disconnect", disconnect!)}
          >
            Deconectează
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export function GmailAutopilotPanel({ data, manager, refresh }: Props) {
  const [leadListId, setLeadListId] = useState(data.gmail_lead_list_id || "");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState(false);
  const connected = data.gmail_accounts.filter(
    (account) => account.status === "connected",
  );
  const inbound = data.messages.filter(
    (message) => message.direction === "inbound",
  );
  const outbound = data.messages.filter(
    (message) =>
      message.direction === "outbound" &&
      message.provider === "gmail" &&
      message.sent_at,
  );
  const blocked = new Set(
    data.messages
      .filter(
        (message) =>
          message.direction === "inbound" ||
          [
            "sent",
            "delivered",
            "opened",
            "sending",
            "failed",
            "bounced",
          ].includes(message.status),
      )
      .map((message) => message.lead_id),
  );
  const activeCampaigns = new Set(
    data.campaigns.filter((c) => c.status === "active").map((c) => c.id),
  );
  for (const member of data.campaign_leads)
    if (!member.stopped_at && activeCampaigns.has(member.campaign_id))
      blocked.add(member.lead_id);
  const candidates = data.leads.filter(
    (lead) =>
      lead.lead_list_id === leadListId &&
      ["NEW", "READY_FOR_OUTREACH"].includes(lead.status) &&
      !lead.do_not_contact &&
      validProspectEmail(lead.email) &&
      !/(demo|test|evaluare|synthetic)/i.test(lead.source) &&
      !blocked.has(lead.id),
  );
  const used = Object.values(data.gmail_today).reduce(
      (sum, count) => sum + count,
      0,
    ),
    capacity = connected.reduce((sum, account) => sum + account.daily_cap, 0);
  const setupProblems = [
    !data.providers.gmail && "Finalizează configurarea conexiunii Google.",
    !data.providers.google_gemini && "Configurează asistentul AI pe server.",
    !data.providers.gmail_scheduler &&
      "Configurează programarea automată pe server.",
    !connected.length && "Conectează cel puțin o căsuță Gmail.",
    connected.some((account) => !account.last_test_at) &&
      "Trimite un test intern din fiecare căsuță Gmail conectată.",
    data.delivery !== "live" &&
      "Activează livrarea reală în configurația serverului (EMAIL_DELIVERY_MODE=live), apoi publică din nou aplicația.",
  ].filter(Boolean);
  async function act(action: string) {
    setBusy(true);
    setNotice("");
    try {
      await request("/api/gmail/autopilot", {
        action,
        confirmed: action === "start",
        ...(action === "start" ? { lead_list_id: leadListId } : {}),
      });
      await refresh();
      setConfirm(false);
      setNotice(
        action === "start"
          ? "Autopilot este pornit. Continuă automat în intervalul de trimitere."
          : "Autopilot este în pauză.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Acțiune nereușită.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gmail-command-center">
      <section className="gmail-command-hero">
        <div>
          <span
            className={`gmail-running-state ${data.gmail_autopilot_enabled ? "running" : ""}`}
          >
            <span className="gmail-dot" />
            {data.gmail_autopilot_enabled
              ? "Autopilot pornit"
              : "Autopilot în pauză"}
          </span>
          <h2>
            Leadurile tale.
            <br />
            Următoarea conversație.
          </h2>
          <p>
            Voxa personalizează mesajele, le trimite din Gmail și aduce
            răspunsurile aici.
          </p>
        </div>
        <div className="gmail-command-controls">
          <label className="field">
            Campania care rulează
            <select
              value={leadListId}
              disabled={busy || data.gmail_autopilot_enabled}
              onChange={(e) => setLeadListId(e.target.value)}
            >
              <option value="">Alege o campanie</option>
              {data.lead_lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ·{" "}
                  {
                    data.leads.filter((lead) => lead.lead_list_id === list.id)
                      .length
                  }{" "}
                  leaduri
                </option>
              ))}
            </select>
          </label>
          {!data.lead_lists.length && (
            <Link href="/leads">Creează prima campanie în Leads</Link>
          )}
          <Button
            disabled={
              !manager || busy || (!data.gmail_autopilot_enabled && !leadListId)
            }
            onClick={() =>
              data.gmail_autopilot_enabled
                ? act("pause")
                : setupProblems.length
                  ? setNotice(setupProblems.join(" "))
                  : setConfirm(true)
            }
          >
            {data.gmail_autopilot_enabled ? (
              <Pause size={18} aria-hidden="true" />
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
            {data.gmail_autopilot_enabled
              ? "Pune în pauză"
              : "Pornește Autopilot"}
          </Button>
          <small>
            Luni–vineri, 08:00–12:00
            <br />
            Ora României · Weekend: pauză
          </small>
        </div>
      </section>
      {notice && (
        <p className="gmail-notice" role="status">
          {notice}
        </p>
      )}
      <div className="gmail-flow-stats">
        <div>
          <strong>{candidates.length}</strong>
          <span>Leaduri disponibile</span>
        </div>
        <div>
          <strong>
            {used}
            <small> / {capacity}</small>
          </strong>
          <span>Trimiteri rezervate azi</span>
        </div>
        <div>
          <strong>{outbound.length}</strong>
          <span>Emailuri trimise prin Gmail</span>
        </div>
        <div>
          <strong>{inbound.length}</strong>
          <span>Răspunsuri primite</span>
        </div>
      </div>
      {data.gmail_autopilot_enabled && (
        <p className="gmail-notice" role="status">
          {!connected.length
            ? "Autopilot așteaptă o căsuță conectată. Verifică mesajele din secțiunea Gmail."
            : connected.every(
                  (account) =>
                    (data.gmail_today[account.id] || 0) >= account.daily_cap,
                )
              ? "Limitele de azi sunt atinse. Trimiterile se reiau în următoarea zi de lucru."
              : !sendingWindow(new Date())
                ? "Autopilot așteaptă intervalul de trimitere: luni–vineri, 08:00–12:00."
                : !candidates.length &&
                    !data.campaign_leads.some(
                      (member) =>
                        !member.stopped_at &&
                        connected.some(
                          (account) =>
                            account.campaign_id === member.campaign_id,
                        ) &&
                        data.leads.some(
                          (lead) =>
                            lead.id === member.lead_id &&
                            ["NEW", "ENRICHING", "READY_FOR_OUTREACH"].includes(
                              lead.status,
                            ),
                        ),
                    )
                  ? "Toate leadurile eligibile au fost preluate. Autopilot așteaptă un import nou."
                  : "Leadurile sunt prelucrate automat, în limita fiecărei căsuțe."}
        </p>
      )}
      <div className="gmail-pipeline">
        <span>
          <Check size={15} aria-hidden="true" />
          Leaduri importate
        </span>
        <ChevronRight size={15} aria-hidden="true" />
        <span>
          <Mail size={15} aria-hidden="true" />
          Mesaje personalizate
        </span>
        <ChevronRight size={15} aria-hidden="true" />
        <span>Trimitere programată</span>
        <ChevronRight size={15} aria-hidden="true" />
        <Link href="/inbox">
          <Inbox size={15} aria-hidden="true" />
          Răspunsuri într-un singur loc
        </Link>
      </div>
      <GmailAccountsPanel data={data} manager={manager} refresh={refresh} />
      <section className="gmail-recent panel">
        <div className="gmail-section-head">
          <div>
            <h2>Ultimele răspunsuri</h2>
            <p>Vezi cine a răspuns și căsuța care a primit mesajul.</p>
          </div>
          <Link className="gmail-text-link" href="/inbox">
            Deschide Inbox
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {inbound.length ? (
          inbound.slice(0, 5).map((message) => (
            <Link
              href={`/inbox?lead=${encodeURIComponent(message.lead_id)}`}
              className="gmail-reply-row"
              key={message.id}
            >
              <span className="gmail-avatar">
                {data.leads
                  .find((lead) => lead.id === message.lead_id)
                  ?.company_name.slice(0, 1) || "M"}
              </span>
              <div>
                <strong>
                  {String(
                    metadata(message.metadata).from_email ||
                      data.leads.find((lead) => lead.id === message.lead_id)
                        ?.email ||
                      "Expeditor necunoscut",
                  )}
                </strong>
                <p>{(message.body || "").slice(0, 140)}</p>
                <small>
                  Primit în{" "}
                  {String(
                    metadata(message.metadata).mailbox_email ||
                      "căsuța campaniei",
                  )}
                </small>
              </div>
              <time>{dateTime(message.received_at || message.created_at)}</time>
            </Link>
          ))
        ) : (
          <div className="gmail-empty">
            <Inbox size={26} aria-hidden="true" />
            <h3>Răspunsurile vor apărea aici</h3>
            <p>
              Sincronizăm conversațiile pornite de Voxa din toate căsuțele
              conectate.
            </p>
          </div>
        )}
      </section>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Pornește Autopilot Gmail"
      >
        <p>
          Fiecare lead primește un email nou, cu o singură ofertă aleasă din
          context. Limitele zilnice includ și răspunsurile trimise de asistent.
          Poți pune Autopilot în pauză oricând.
        </p>
        <div className="gmail-approved-template">
          <strong>Cum sunt scrise emailurile</strong>
          <p>{approvedOutreachTemplate}</p>
        </div>
        <p className="helper-text">
          {connected.length} căsuțe conectate · cel mult {capacity} trimiteri pe
          zi · un lead este contactat o singură dată. La epuizarea leadurilor,
          Autopilot așteaptă următorul import.
        </p>
        <div className="actions section-gap">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Renunță
          </Button>
          <Button disabled={busy} onClick={() => act("start")}>
            <Play size={16} aria-hidden="true" />
            Aprobă și pornește
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function GmailInbox({
  data,
  manager,
  refresh,
  act,
}: Props & { act: (action: string, input: unknown) => Promise<unknown> }) {
  const params = useSearchParams();
  const threadTrigger = useRef<HTMLButtonElement | null>(null);
  const threadBack = useRef<HTMLButtonElement | null>(null);
  const [mobileThread, setMobileThread] = useState(!!params.get("lead"));
  const [query, setQuery] = useState(""),
    [mailbox, setMailbox] = useState(""),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [replySection, setReplySection] = useState<"all" | "hot">("all");
  const conversations = inboxConversations(
    data,
    query,
    mailbox,
    attentionOnly,
    true,
    replySection === "hot",
  );
  const hotCount = inboxConversations(
    data,
    "",
    mailbox,
    false,
    true,
    true,
  ).length;
  const preferred = selected || params.get("lead") || "";
  const conversation =
    conversations.find((item) => item.id === preferred) || conversations[0];
  const active = conversation?.id;
  const lead = conversation?.lead;
  const thread = conversation?.messages || [];
  const received = conversation?.received;
  const hasActiveLead = !!lead;
  useEffect(() => {
    if (!window.matchMedia("(max-width: 960px)").matches) return;
    if (mobileThread && hasActiveLead)
      threadBack.current?.focus({ preventScroll: true });
    else if (threadTrigger.current?.isConnected)
      threadTrigger.current.focus({ preventScroll: true });
  }, [mobileThread, active, hasActiveLead]);
  async function sync() {
    setBusy(true);
    setNotice("");
    try {
      const result = await request("/api/gmail/autopilot", { action: "sync" });
      await refresh();
      setNotice(
        result.results.some((r: { ok: boolean }) => !r.ok)
          ? "Unele căsuțe nu s-au actualizat. Verifică conexiunile Gmail."
          : "Răspunsurile sunt actualizate.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Actualizare nereușită.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gmail-inbox-page">
      <div className="gmail-section-head">
        <div>
          <h2>Răspunsurile tale, într-un singur loc.</h2>
          <p>
            Toate răspunsurile la emailurile Voxa, într-un singur loc. Tu
            răspunzi; AI-ul doar clasifică.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!manager || busy || !data.gmail_accounts.length}
          onClick={sync}
        >
          <RefreshCw size={16} aria-hidden="true" />
          Actualizează răspunsurile
        </Button>
      </div>
      {notice && (
        <p className="gmail-notice" role="status">
          {notice}
        </p>
      )}
      <div
        className={`panel gmail-unified-inbox ${mobileThread && lead ? "mobile-thread-open" : ""}`}
      >
        <aside className="gmail-conversation-list">
          <div
            className="actions section-gap"
            role="group"
            aria-label="Secțiuni răspunsuri"
          >
            <Button
              variant={replySection === "all" ? "default" : "secondary"}
              aria-pressed={replySection === "all"}
              onClick={() => {
                setReplySection("all");
                setSelected("");
                setMobileThread(false);
              }}
            >
              Toate răspunsurile
            </Button>
            <Button
              variant={replySection === "hot" ? "default" : "secondary"}
              aria-pressed={replySection === "hot"}
              onClick={() => {
                setReplySection("hot");
                setSelected("");
                setMobileThread(false);
              }}
            >
              Hot leads · {hotCount}
            </Button>
          </div>
          {replySection === "hot" && (
            <p className="helper-text">
              Interes explicit pentru demo, test sau ofertă, identificat cu
              încredere ridicată. Verifică mesajul înainte de a răspunde.
            </p>
          )}
          <label className="field">
            Caută conversații
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setMobileThread(false);
              }}
              placeholder="Nume sau adresă de email"
            />
          </label>
          <label className="field">
            Căsuță Gmail
            <select
              value={mailbox}
              onChange={(e) => {
                setMailbox(e.target.value);
                setMobileThread(false);
              }}
            >
              <option value="">Toate căsuțele</option>
              {data.gmail_accounts.map((account) => (
                <option value={account.email} key={account.id}>
                  {account.email}
                </option>
              ))}
            </select>
          </label>
          <label className="gmail-attention-filter">
            <input
              type="checkbox"
              checked={attentionOnly}
              onChange={(event) => setAttentionOnly(event.target.checked)}
            />
            Necesită atenție
          </label>
          <div className="gmail-thread-count">
            {conversations.length}{" "}
            {conversations.length === 1 ? "conversație" : "conversații"}
          </div>
          {conversations.map(
            ({ id, lead: item, received, latest: newest, attention }) => {
              const latest = received || newest;
              return (
                <button
                  type="button"
                  className={`gmail-conversation ${active === id ? "selected" : ""}`}
                  aria-current={active === id ? "true" : undefined}
                  onClick={(event) => {
                    threadTrigger.current = event.currentTarget;
                    setSelected(id);
                    setMobileThread(true);
                  }}
                  key={id}
                >
                  <strong>{item?.company_name || "Conversație"}</strong>
                  {attention && (
                    <small className="gmail-attention-badge">
                      Necesită atenție
                    </small>
                  )}
                  <span>
                    {String(
                      metadata(latest?.metadata).from_email ||
                        item?.email ||
                        "",
                    )}
                  </span>
                  <p>{latest?.body.slice(0, 95)}</p>
                  {!!metadata(latest?.metadata).mailbox_email && (
                    <small>
                      În {String(metadata(latest?.metadata).mailbox_email)}
                    </small>
                  )}
                </button>
              );
            },
          )}
          {!conversations.length && (
            <p className="quiet-empty">
              {query || mailbox || attentionOnly
                ? "Nicio conversație pentru filtrele alese."
                : "Răspunsurile vor apărea după prima conversație."}
            </p>
          )}
        </aside>
        <section className="gmail-conversation-detail">
          {lead ? (
            <>
              <header className="gmail-thread-header">
                <Button
                  ref={threadBack}
                  className="mobile-inbox-back"
                  variant="ghost"
                  onClick={() => setMobileThread(false)}
                >
                  <ArrowLeft size={18} aria-hidden="true" />
                  Toate conversațiile
                </Button>
                <div>
                  <h3>{lead.company_name}</h3>
                  <a href={`mailto:${lead.email}`}>{lead.email}</a>
                </div>
                {received && (
                  <span className="gmail-mailbox-tag">
                    <Mail size={14} aria-hidden="true" />
                    {String(
                      metadata(received.metadata).mailbox_email || "Email",
                    )}
                  </span>
                )}
              </header>
              {notice && (
                <p className="gmail-notice mobile-thread-notice" role="status">
                  {notice}
                </p>
              )}
              <div className="gmail-thread-body">
                {thread.map((message) => {
                  const meta = metadata(message.metadata),
                    sender =
                      message.direction === "inbound"
                        ? String(meta.from_email || lead.email)
                        : String(
                            meta.mailbox_email ||
                              data.campaigns.find(
                                (c) => c.id === message.campaign_id,
                              )?.sender_identity ||
                              "Echipa Voxa",
                          );
                  return (
                    <article
                      className={`gmail-email ${message.direction}`}
                      key={message.id}
                    >
                      <div className="gmail-email-heading">
                        <strong>{sender}</strong>
                        <time>
                          {dateTime(
                            message.received_at ||
                              message.sent_at ||
                              message.created_at,
                          )}
                        </time>
                      </div>
                      <small>
                        {message.direction === "inbound"
                          ? `Către: ${String(meta.mailbox_email || meta.to_email || "Voxa")}`
                          : `Către: ${lead.email}`}{" "}
                        ·{" "}
                        {message.direction === "inbound"
                          ? "Primit"
                          : messageStatusLabel[message.status] ||
                            message.status}
                      </small>
                      {!!meta.sender_mismatch && (
                        <p className="gmail-notice">
                          Expeditor diferit de adresa leadului. Verifică manual
                          înainte de răspuns.
                        </p>
                      )}
                      <h4>{message.subject || "Fără subiect"}</h4>
                      <p>{message.body}</p>
                      {Array.isArray(meta.attachment_names) &&
                        meta.attachment_names.length > 0 && (
                          <small className="gmail-attachments">
                            Atașamente:{" "}
                            {meta.attachment_names
                              .map((name) => String(name))
                              .join(", ")}
                            . Deschide căsuța Gmail pentru a le vedea.
                          </small>
                        )}
                      {message.direction === "outbound" &&
                        message.status === "draft" &&
                        (!message.in_reply_to || meta.manual_reply === true) &&
                        manager && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await act("message_approve", {
                                  id: message.id,
                                });
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Aprobă trimiterea
                          </Button>
                        )}
                    </article>
                  );
                })}
              </div>
              {manager && received && (
                <form
                  className="gmail-reply-composer"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    setBusy(true);
                    const result = await act("message_reply", {
                      lead_id: active,
                      inbound_id: received?.id,
                      body: String(new FormData(form).get("body")),
                      send:
                        (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                          "value",
                        ) === "send",
                    });
                    setBusy(false);
                    if (result) {
                      form.reset();
                      setNotice(
                        (result as { queued?: boolean }).queued
                          ? "Răspunsul tău a fost pus la trimitere. Se aplică limitele căsuței și programul campaniei."
                          : "Ciorna a fost salvată. Nu s-a trimis niciun email.",
                      );
                    }
                  }}
                >
                  <label className="field">
                    Răspuns manual către {lead.email}
                    <textarea
                      key={received.id}
                      defaultValue={
                        thread.find(
                          (m) =>
                            m.in_reply_to === received.id &&
                            m.status === "draft" &&
                            metadata(m.metadata).manual_reply === true,
                        )?.body || ""
                      }
                      name="body"
                      required
                      maxLength={20000}
                      rows={3}
                      placeholder="Scrie răspunsul tău…"
                    />
                  </label>
                  <p>
                    Din:{" "}
                    {String(
                      metadata(received.metadata).mailbox_email ||
                        "căsuța care a primit mesajul",
                    )}
                    . Răspunsul păstrează conversația Gmail.
                  </p>
                  <Button
                    name="intent"
                    value="send"
                    disabled={busy || lead.do_not_contact}
                  >
                    Trimite răspunsul
                  </Button>
                  <Button
                    name="intent"
                    value="draft"
                    variant="secondary"
                    disabled={busy || lead.do_not_contact}
                  >
                    Salvează ciorna
                  </Button>
                </form>
              )}
            </>
          ) : (
            <div className="gmail-empty">
              <Inbox size={30} aria-hidden="true" />
              <h3>
                {query || mailbox || attentionOnly
                  ? "Nicio conversație selectată"
                  : "Conversațiile încep cu un mesaj"}
              </h3>
              <p>
                {query || mailbox || attentionOnly
                  ? "Schimbă filtrele pentru a vedea celelalte conversații."
                  : "Conectează Gmail și pornește Autopilot pentru leadurile tale."}
              </p>
              <Link className="gmail-text-link" href="/autopilot">
                Deschide Autopilot
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
