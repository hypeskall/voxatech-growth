"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import {
  Check,
  CircleAlert,
  Download,
  Eye,
  FilePenLine,
  MailCheck,
  RefreshCw,
  Rocket,
  Save,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Modal } from "./ui/dialog";
import { Table } from "./ui/table";
import type { Snapshot } from "@/lib/snapshot";
import type { Json } from "@/lib/supabase/database.types";
import {
  hasIdentityAndOptOut,
  launchConfirmation,
  validProspectEmail,
} from "@/lib/launch";

type ReviewStatus =
  | "Draft"
  | "Approved"
  | "Rejected"
  | "Test sent"
  | "Scheduled"
  | "Sent"
  | "Replied"
  | "Bounced"
  | "Unsubscribed";

const statuses: ReviewStatus[] = [
  "Draft",
  "Approved",
  "Rejected",
  "Test sent",
  "Scheduled",
  "Sent",
  "Replied",
  "Bounced",
  "Unsubscribed",
];

const statusLabels: Record<ReviewStatus, string> = {
  Draft: "Ciornă",
  Approved: "Aprobat",
  Rejected: "Respins",
  "Test sent": "Test trimis",
  Scheduled: "Programat",
  Sent: "Trimis",
  Replied: "A răspuns",
  Bounced: "Respins de server",
  Unsubscribed: "Dezabonat",
};

function object(value: Json | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function CampaignReviewCenter({
  data,
  campaignId,
  busy,
  manager,
  act,
  requestInternalTest,
}: {
  data: Snapshot;
  campaignId: string;
  busy: boolean;
  manager: boolean;
  act: (action: string, input: unknown) => Promise<unknown>;
  requestInternalTest: (messageId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftEdit, setDraftEdit] = useState({ subject: "", body: "" });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [launchOpen, setLaunchOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const campaign = data.campaigns.find((item) => item.id === campaignId);
  const memberships = data.campaign_leads.filter(
    (item) => item.campaign_id === campaignId && !item.stopped_at,
  );
  const rows = memberships.map((membership) => {
    const lead = data.leads.find((item) => item.id === membership.lead_id);
    const message = data.messages.find((item) => {
      const metadata = object(item.metadata);
      return (
        item.campaign_id === campaignId &&
        item.lead_id === membership.lead_id &&
        metadata.outreach_variant === "B"
      );
    });
    const inbound = data.messages.some(
      (item) =>
        item.lead_id === membership.lead_id && item.direction === "inbound",
    );
    const suppressed = data.suppression_list.some(
      (item) =>
        item.lead_id === membership.lead_id ||
        (!!lead?.email && item.identifier === lead.email.toLowerCase()),
    );
    const metadata = object(message?.metadata);
    let status: ReviewStatus = "Draft";
    if (suppressed || lead?.status === "DO_NOT_CONTACT")
      status = "Unsubscribed";
    else if (inbound || lead?.status === "REPLIED") status = "Replied";
    else if (message?.status === "bounced") status = "Bounced";
    else if (["sent", "delivered", "opened"].includes(message?.status || ""))
      status = "Sent";
    else if (["queued", "sending"].includes(message?.status || ""))
      status = "Scheduled";
    else if (metadata.review_state === "test_sent") status = "Test sent";
    else if (metadata.review_state === "rejected") status = "Rejected";
    else if (message?.status === "approved") status = "Approved";
    return { lead, message, metadata, status };
  });

  const counts = Object.fromEntries(
    statuses.map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  ) as Record<ReviewStatus, number>;
  const latestEvaluations = useMemo(() => {
    const byLead = new Map<string, Snapshot["activities"][number]>();
    for (const activity of data.activities) {
      const details = object(activity.details);
      if (
        activity.action === "ai_batch_evaluation" &&
        details.campaign_id === campaignId &&
        activity.lead_id &&
        !byLead.has(activity.lead_id)
      )
        byLead.set(activity.lead_id, activity);
    }
    return byLead;
  }, [campaignId, data.activities]);
  const estimatedCost = [...latestEvaluations.values()].reduce(
    (sum, activity) =>
      sum + Number(object(activity.details).estimated_cost_usd || 0),
    0,
  );
  const resend = data.integrations.find((item) => item.provider === "resend");
  const resendConfig = object(resend?.public_config);
  const gmail = data.gmail_accounts.find(
    (account) => account.email === campaign?.sender_identity,
  );
  const senderVerified = gmail
    ? data.providers.gmail && gmail.status === "connected"
    : data.providers.resend &&
      !!resend?.last_verified_at &&
      resendConfig.sender_domain_verified === true;
  const recipientsValid =
    rows.length > 0 && rows.every((row) => validProspectEmail(row.lead?.email));
  const approvedComplete =
    rows.length > 0 && rows.every((row) => row.message?.status === "approved");
  const copyCompliant =
    rows.length > 0 &&
    rows.every(
      (row) => !!row.message && hasIdentityAndOptOut(row.message.body),
    );
  const dailyLimitValid =
    !!campaign && campaign.daily_cap > 0 && campaign.daily_cap <= 10;
  const liveMode = data.delivery === "live";
  const canOpenLaunch =
    senderVerified &&
    recipientsValid &&
    approvedComplete &&
    copyCompliant &&
    dailyLimitValid &&
    liveMode;

  const checklist = [
    ["Expeditor conectat și verificat", senderVerified],
    ["Toți destinatarii au email valid, fără placeholder", recipientsValid],
    ["Toate Variantele B sunt aprobate", approvedComplete],
    [
      "Identitatea Voxa, voxatech.ro și linia de opt-out sunt prezente",
      copyCompliant,
    ],
    ["Limita zilnică este maximum 10", dailyLimitValid],
    ["Livrarea reală este activată explicit în mediu", liveMode],
    ["Confirmarea manuală finală", false],
  ] as const;

  function exportApproved() {
    const approved = rows
      .filter((row) => row.message?.status === "approved")
      .map((row) => ({
        clinică: row.lead?.company_name || "",
        email: row.lead?.email || "",
        scor: row.lead?.lead_score ?? "",
        subiect: row.message?.subject || "",
        mesaj: row.message?.body || "",
        notă_internă: String(row.metadata.internal_note || ""),
      }));
    const csv = Papa.unparse(approved, { escapeFormulae: true });
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `voxa-campanie-aprobata-${campaignId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!campaign)
    return (
      <div className="panel panel-body">
        <h2>Campanie indisponibilă</h2>
        <p className="copy">Campania nu există sau nu este accesibilă.</p>
      </div>
    );

  return (
    <>
      <div className="review-hero panel">
        <div>
          <Link className="muted" href="/campaigns">
            ← Înapoi la campanii
          </Link>
          <p className="eyebrow">Review &amp; Launch Center</p>
          <h2>{campaign.name}</h2>
          <p className="copy">
            Varianta B este recomandată. Niciun mesaj către prospect nu pleacă
            din această pagină fără aprobarea și lansarea finală.
          </p>
        </div>
        <div className="actions">
          <Button
            variant="secondary"
            disabled={!rows.some((row) => row.message?.status === "approved")}
            onClick={exportApproved}
          >
            <Download size={15} /> Exportă aprobările CSV
          </Button>
          <Button
            disabled={!manager || !canOpenLaunch || busy}
            onClick={() => setLaunchOpen(true)}
          >
            <Rocket size={15} /> Lansare reală
          </Button>
        </div>
      </div>

      <div className="review-counter-grid">
        {statuses.map((status) => (
          <div className="review-counter" key={status}>
            <strong>{counts[status]}</strong>
            <span>{statusLabels[status]}</span>
          </div>
        ))}
        <div className="review-counter cost">
          <strong>${estimatedCost.toFixed(6)}</strong>
          <span>Cost AI estimat</span>
        </div>
      </div>

      <section className="panel launch-checklist">
        <div className="panel-head">
          <div>
            <h2>Checklist înainte de lansare</h2>
            <small>
              Verificările sunt repetate pe server înainte de activare.
            </small>
          </div>
          {!gmail && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!manager || busy || !data.providers.resend}
              onClick={() => act("resend_verify_sender", {})}
            >
              <RefreshCw size={14} /> Verifică domeniul Resend
            </Button>
          )}
        </div>
        <div className="checklist-grid">
          {checklist.map(([label, complete]) => (
            <div
              className={`check-item ${complete ? "complete" : ""}`}
              key={label}
            >
              {complete ? <Check size={16} /> : <CircleAlert size={16} />}
              <span>{label}</span>
            </div>
          ))}
        </div>
        {!liveMode && (
          <p className="callout section-gap">
            Modul local este activ. Testele pot merge numai la adresa internă
            configurată; activarea reală rămâne blocată.
          </p>
        )}
      </section>

      <section className="panel review-table-panel">
        <div className="panel-head">
          <div>
            <h2>Prospecte și Varianta B</h2>
            <small>{rows.length} destinatari selectați</small>
          </div>
        </div>
        <Table>
          <thead>
            <tr>
              <th>Prospect</th>
              <th>Email</th>
              <th>Scor</th>
              <th>Status</th>
              <th>Subiect</th>
              <th>Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ lead, message, metadata, status }) => (
              <ReviewRow
                key={lead?.id || message?.id}
                lead={lead}
                message={message}
                metadata={metadata}
                status={status}
                busy={busy}
                manager={manager}
                expanded={expanded === message?.id}
                editing={editing === message?.id}
                draftEdit={draftEdit}
                note={
                  notes[message?.id || ""] ??
                  String(metadata.internal_note || "")
                }
                onNote={(value) =>
                  message &&
                  setNotes((current) => ({ ...current, [message.id]: value }))
                }
                onExpand={() =>
                  message &&
                  setExpanded(expanded === message.id ? null : message.id)
                }
                onEdit={() => {
                  if (!message) return;
                  setExpanded(message.id);
                  setEditing(message.id);
                  setDraftEdit({
                    subject: message.subject || "",
                    body: message.body,
                  });
                }}
                onEditChange={setDraftEdit}
                onCancelEdit={() => setEditing(null)}
                onAct={act}
                requestInternalTest={requestInternalTest}
              />
            ))}
          </tbody>
        </Table>
      </section>

      <Modal
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        title="Confirmare finală de lansare"
      >
        <p className="copy">
          Această acțiune permite livrarea către destinatarii aprobați. Scrie
          exact
          <strong> {launchConfirmation}</strong> pentru confirmare.
        </p>
        <label className="field section-gap">
          Confirmare manuală
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="actions section-gap">
          <Button variant="secondary" onClick={() => setLaunchOpen(false)}>
            Renunță
          </Button>
          <Button
            disabled={confirmation !== launchConfirmation || busy}
            onClick={async () => {
              const result = await act("campaign_status", {
                id: campaign.id,
                status: "active",
                confirmation,
              });
              if (result) setLaunchOpen(false);
            }}
          >
            Confirmă lansarea
          </Button>
        </div>
      </Modal>
    </>
  );
}

function ReviewRow({
  lead,
  message,
  metadata,
  status,
  busy,
  manager,
  expanded,
  editing,
  draftEdit,
  note,
  onNote,
  onExpand,
  onEdit,
  onEditChange,
  onCancelEdit,
  onAct,
  requestInternalTest,
}: {
  lead: Snapshot["leads"][number] | undefined;
  message: Snapshot["messages"][number] | undefined;
  metadata: Record<string, Json | undefined>;
  status: ReviewStatus;
  busy: boolean;
  manager: boolean;
  expanded: boolean;
  editing: boolean;
  draftEdit: { subject: string; body: string };
  note: string;
  onNote: (value: string) => void;
  onExpand: () => void;
  onEdit: () => void;
  onEditChange: (value: { subject: string; body: string }) => void;
  onCancelEdit: () => void;
  onAct: (action: string, input: unknown) => Promise<unknown>;
  requestInternalTest: (messageId: string) => void;
}) {
  const tone = ["Approved", "Sent", "Replied", "Test sent"].includes(status)
    ? "green"
    : ["Rejected", "Bounced", "Unsubscribed"].includes(status)
      ? "red"
      : status === "Scheduled"
        ? "purple"
        : "";
  return (
    <>
      <tr>
        <td>
          {lead ? (
            <Link href={`/leads/${lead.id}`}>{lead.company_name}</Link>
          ) : (
            "—"
          )}
        </td>
        <td>
          <span
            className={validProspectEmail(lead?.email) ? "" : "text-warning"}
          >
            {lead?.email || "Lipsește"}
          </span>
        </td>
        <td>{lead?.lead_score ?? 0}/100</td>
        <td>
          <span className={`badge ${tone}`}>{statusLabels[status]}</span>
        </td>
        <td style={{ whiteSpace: "normal", minWidth: 230 }}>
          {message?.subject || "Ciornă lipsă"}
        </td>
        <td>
          <div className="actions review-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={!message}
              onClick={onExpand}
            >
              <Eye size={14} /> Deschide
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!message || busy}
              onClick={onEdit}
            >
              <FilePenLine size={14} /> Editează
            </Button>
            <Button
              size="sm"
              disabled={!manager || !message || busy || status === "Approved"}
              onClick={() =>
                message && onAct("message_approve", { id: message.id })
              }
            >
              <Check size={14} /> Aprobă
            </Button>
          </div>
        </td>
      </tr>
      {expanded && message && (
        <tr className="review-detail-row">
          <td colSpan={6}>
            <div className="review-detail">
              <div className="review-draft">
                {editing ? (
                  <>
                    <label className="field">
                      Subiect
                      <input
                        value={draftEdit.subject}
                        onChange={(event) =>
                          onEditChange({
                            ...draftEdit,
                            subject: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="field section-gap">
                      Mesaj
                      <textarea
                        rows={10}
                        value={draftEdit.body}
                        onChange={(event) =>
                          onEditChange({
                            ...draftEdit,
                            body: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="actions section-gap">
                      <Button
                        size="sm"
                        disabled={busy || !draftEdit.body.trim()}
                        onClick={async () => {
                          const result = await onAct("message_save", {
                            id: message.id,
                            subject: draftEdit.subject,
                            body: draftEdit.body,
                          });
                          if (result) onCancelEdit();
                        }}
                      >
                        <Save size={14} /> Salvează
                      </Button>
                      <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                        <X size={14} /> Renunță
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3>{message.subject}</h3>
                    <p className="copy review-copy">{message.body}</p>
                    <small>
                      Cost AI estimat: $
                      {Number(metadata.estimated_cost_usd || 0).toFixed(6)}
                    </small>
                  </>
                )}
              </div>
              <aside className="review-notes">
                <label className="field">
                  Notă internă
                  <textarea
                    rows={5}
                    value={note}
                    onChange={(event) => onNote(event.target.value)}
                  />
                </label>
                <div className="actions section-gap">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      onAct("message_note", { id: message.id, note })
                    }
                  >
                    Salvează nota
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!manager || busy}
                    onClick={() => requestInternalTest(message.id)}
                  >
                    <MailCheck size={14} /> Trimite test mie
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!manager || busy}
                    onClick={() =>
                      onAct("message_regenerate", { id: message.id })
                    }
                  >
                    <RefreshCw size={14} /> Regenerează
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!manager || busy}
                    onClick={() =>
                      onAct("message_reject", { id: message.id, note })
                    }
                  >
                    <X size={14} /> Respinge
                  </Button>
                </div>
                <p className="muted section-gap" style={{ fontSize: 12 }}>
                  Testul este trimis exclusiv la INTERNAL_TEST_EMAIL. Adresa
                  prospectului nu este folosită.
                </p>
              </aside>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
