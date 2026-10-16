"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { Modal } from "./ui/dialog";
import { Button } from "./ui/button";
import { approvedOutreachTemplate } from "@/lib/outreach-template";
import type { Snapshot } from "@/lib/snapshot";
import type { Row } from "@/lib/domain";
export function CampaignWizard({
  open,
  onClose,
  data,
  campaign,
  busy,
  act,
  initialStep = 0,
}: {
  open: boolean;
  onClose: () => void;
  data: Snapshot;
  campaign?: Row<"campaigns">;
  busy: boolean;
  act: (action: string, input: unknown) => Promise<unknown>;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep),
    [selected, setSelected] = useState<string[]>(
      campaign
        ? data.campaign_leads
            .filter((l) => l.campaign_id === campaign.id)
            .map((l) => l.lead_id)
        : [],
    ),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<string | null>(null);
  const [fields, setFields] = useState({
    name: campaign?.name || "",
    niche: campaign?.niche || "",
    cities: campaign?.cities.join(", ") || "",
    sender_identity:
      campaign?.sender_identity ||
      data.gmail_accounts.find((account) => account.status === "connected")
        ?.email ||
      "",
    tone: campaign?.tone || "profesional, natural",
    offer:
      campaign?.offer ||
      "Voxa — 30 de zile de test complet gratuit, fără nicio obligație ulterior.",
    daily_cap: campaign?.daily_cap || 10,
    window_start: campaign?.window_start.slice(0, 5) || "09:30",
    window_end: campaign?.window_end.slice(0, 5) || "16:30",
    mode: campaign?.mode || "approval_required",
    first_message: campaign?.first_message || approvedOutreachTemplate,
    follow_up_1:
      campaign?.follow_up_1 || "O revenire scurtă și utilă, fără presiune.",
    follow_up_2:
      campaign?.follow_up_2 ||
      "Ultima revenire, cu opțiunea clară de a opri conversația.",
    min_score: String(
      (campaign?.target_filters as Record<string, unknown>)?.min_score || "0",
    ),
    target_source: String(
      (campaign?.target_filters as Record<string, unknown>)?.source || "",
    ),
  });
  const steps = [
    "Select Leads",
    "Write Message",
    "Sequence",
    "Review",
    "Launch",
  ];
  function field(label: string, key: keyof typeof fields, type = "text") {
    return (
      <label className="field">
        {label}
        <input
          type={type}
          value={fields[key]}
          onChange={(e) =>
            setFields({
              ...fields,
              [key]:
                key === "daily_cap" ? Number(e.target.value) : e.target.value,
            })
          }
          disabled={busy || !!saved}
        />
      </label>
    );
  }
  function area(
    label: string,
    key: "first_message" | "follow_up_1" | "follow_up_2" | "offer",
    rows = 4,
  ) {
    return (
      <label className="field full">
        {label}
        <textarea
          rows={rows}
          value={fields[key]}
          onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
          disabled={busy || !!saved}
        />
      </label>
    );
  }
  function next() {
    setError("");
    if (
      step === 0 &&
      (fields.name.trim().length < 2 || (!campaign && !selected.length))
    ) {
      setError("Dă un nume campaniei și selectează cel puțin un lead.");
      return;
    }
    if (
      step === 1 &&
      (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.sender_identity) ||
        !fields.first_message.trim())
    ) {
      setError("Completează expeditorul verificat și mesajul.");
      return;
    }
    if (
      step === 2 &&
      (fields.daily_cap < 1 ||
        fields.daily_cap > 1000 ||
        fields.window_start >= fields.window_end)
    ) {
      setError("Verifică limita zilnică și intervalul orar.");
      return;
    }
    setStep(step + 1);
  }
  async function save() {
    setError("");
    const result = (await act("campaign_save", {
      id: campaign?.id,
      campaign: {
        ...fields,
        cities: fields.cities
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        target_filters: {
          min_score: fields.min_score,
          source: fields.target_source,
        },
      },
    })) as { id?: string } | null;
    if (!result?.id) {
      setError("Campania nu a fost salvată. Verifică toate câmpurile.");
      return;
    }
    setSaved(result.id);
    const assigned = selected.length
      ? await act("bulk_campaign", {
          ids: selected,
          campaign_id: result.id,
        })
      : true;
    if (assigned === null) {
      setError(
        "Campania este salvată, dar unele leaduri nu corespund filtrelor. Revizuiește audiența înainte de lansare.",
      );
    }
    setStep(4);
  }
  return (
    <Modal
      open={open}
      onOpenChange={onClose}
      title={campaign ? "Editează campania" : "Campanie nouă"}
    >
      <div className="wizard" aria-busy={busy}>
        <ol className="wizard-steps" aria-label="Pașii campaniei">
          {steps.map((label, i) => (
            <li
              className={i === step ? "current" : i < step ? "done" : ""}
              key={label}
              aria-current={i === step ? "step" : undefined}
            >
              <span>{i < step ? <Check size={13} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        {step === 0 && (
          <div className="wizard-body">
            <h2>Cu cine începi conversația?</h2>
            <p>
              Alege leadurile potrivite. Campania rămâne în ciornă până la
              revizuire.
            </p>
            {field("Numele campaniei", "name")}
            <label className="field">
              Caută leaduri
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Companie sau email"
              />
            </label>
            <div className="lead-picker">
              {data.leads
                .filter(
                  (l) =>
                    !l.do_not_contact &&
                    !["LOST", "DO_NOT_CONTACT"].includes(l.status) &&
                    [l.company_name, l.email]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .map((l) => (
                  <label key={l.id}>
                    <input
                      type="checkbox"
                      disabled={
                        busy ||
                        (!!campaign &&
                          data.campaign_leads.some(
                            (cl) =>
                              cl.campaign_id === campaign.id &&
                              cl.lead_id === l.id,
                          ))
                      }
                      checked={selected.includes(l.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, l.id]
                            : selected.filter((id) => id !== l.id),
                        )
                      }
                    />
                    <span>
                      <strong>{l.company_name}</strong>
                      <small>{l.email || "Email necunoscut"}</small>
                    </span>
                  </label>
                ))}
            </div>
            <p>{selected.length} leaduri selectate</p>
            <details className="disclosure">
              <summary>Filtre pentru audiență</summary>
              <div className="form-grid">
                {field("Industrie", "niche")}
                {field("Orașe, separate prin virgulă", "cities")}
                {field("Scor minim", "min_score", "number")}
                {field("Sursă", "target_source")}
              </div>
            </details>
          </div>
        )}
        {step === 1 && (
          <div className="wizard-body">
            <h2>Un mesaj care merită citit.</h2>
            <p>
              Personalizarea folosește datele clinicii. Ciornele generate se
              revizuiesc separat.
            </p>
            {data.gmail_accounts.some(
              (account) => account.status === "connected",
            ) ? (
              <label className="field">
                Căsuță expeditor
                <select
                  value={fields.sender_identity}
                  onChange={(e) =>
                    setFields({ ...fields, sender_identity: e.target.value })
                  }
                >
                  <option value="">Selectează căsuța Gmail</option>
                  {data.gmail_accounts
                    .filter((account) => account.status === "connected")
                    .map((account) => (
                      <option key={account.id} value={account.email}>
                        {account.email}
                      </option>
                    ))}
                  {fields.sender_identity &&
                    !data.gmail_accounts.some(
                      (account) => account.email === fields.sender_identity,
                    ) && (
                      <option value={fields.sender_identity}>
                        {fields.sender_identity}
                      </option>
                    )}
                </select>
              </label>
            ) : (
              field("Email expeditor verificat", "sender_identity", "email")
            )}
            {area(
              "Primul mesaj / instrucțiuni pentru personalizare",
              "first_message",
              10,
            )}
            <details className="disclosure">
              <summary>Ton și ofertă</summary>
              {field("Tonul mesajelor", "tone")}
              {area("Oferta", "offer", 3)}
            </details>
            <p className="helper-text">
              Răspunsurile Gmail revin în căsuța aleasă și apar în Inbox.
            </p>
          </div>
        )}
        {step === 2 && (
          <div className="wizard-body">
            <h2>Un ritm potrivit pentru echipa ta.</h2>
            <p>
              Maximum două reveniri. Răspunsurile și dezabonările opresc automat
              secvența.
            </p>
            {area("Revenire 1", "follow_up_1", 3)}
            {area("Revenire 2", "follow_up_2", 3)}
            <div className="form-grid">
              {field("Limită zilnică", "daily_cap", "number")}
              {field("Început · București", "window_start", "time")}
              {field("Sfârșit · București", "window_end", "time")}
              <label className="field">
                Mod de trimitere
                <select
                  value={fields.mode}
                  onChange={(e) =>
                    setFields({
                      ...fields,
                      mode: e.target.value as typeof fields.mode,
                    })
                  }
                >
                  <option value="approval_required">Cu aprobare</option>
                  <option value="automatic">Automat, după activare</option>
                </select>
              </label>
            </div>
            <p className="helper-text">
              Doar în zile lucrătoare. Pauză de 1–3 minute între mesaje.
            </p>
          </div>
        )}
        {step === 3 && (
          <div className="wizard-body">
            <h2>Verifică înainte de a continua.</h2>
            <dl className="review-summary">
              <div>
                <dt>Campanie</dt>
                <dd>{fields.name}</dd>
              </div>
              <div>
                <dt>Audiență</dt>
                <dd>{selected.length} leaduri</dd>
              </div>
              <div>
                <dt>Expeditor</dt>
                <dd>{fields.sender_identity}</dd>
              </div>
              <div>
                <dt>Ritm</dt>
                <dd>
                  {fields.daily_cap}/zi · {fields.window_start}–
                  {fields.window_end}
                </dd>
              </div>
              <div>
                <dt>Reveniri</dt>
                <dd>Maximum două</dd>
              </div>
            </dl>
            <div className="email-preview">{fields.first_message}</div>
            <p className="helper-text">
              Salvarea nu aprobă mesaje și nu activează campania.
            </p>
          </div>
        )}
        {step === 4 && (
          <div className="wizard-body">
            <ShieldCheck size={30} />
            <h2>Campania este pregătită pentru revizuire.</h2>
            <p>
              {data.delivery === "log"
                ? "Trimiterea reală este dezactivată. Campania este salvată fără activare."
                : "Verifică mesajele și condițiile de lansare înainte de activare."}
            </p>
            {saved && (
              <>
                <Button
                  disabled={busy || selected.length === 0}
                  onClick={async () => {
                    const r = await act("bulk_draft", {
                      ids: selected,
                      campaign_id: saved,
                    });
                    if (r !== null) onClose();
                  }}
                >
                  Pregătește ciornele
                </Button>
                <Link
                  className="button secondary"
                  href={`/campaigns/${saved}/review`}
                  onClick={onClose}
                >
                  Review &amp; Launch
                </Link>
              </>
            )}
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="wizard-footer">
          <Button
            variant="ghost"
            type="button"
            onClick={
              step === 0 || step === 4 ? onClose : () => setStep(step - 1)
            }
            disabled={busy || (!!saved && step !== 4)}
          >
            {step === 0 || step === 4 ? (
              "Închide"
            ) : (
              <>
                <ChevronLeft size={15} />
                Înapoi
              </>
            )}
          </Button>
          {step < 3 && (
            <Button type="button" disabled={busy} onClick={next}>
              Continuă
              <ChevronRight size={15} />
            </Button>
          )}
          {step === 3 && (
            <Button disabled={busy} onClick={save}>
              Salvează în ciornă
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
