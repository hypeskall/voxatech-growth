"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import type { Row } from "@/lib/domain";
import { dateTime } from "@/lib/domain";
import { validProspectEmail } from "@/lib/launch";
type Config = Row<"autopilot_settings">;
type Run = Row<"autopilot_runs"> & {
  discovered: number;
  duplicates: number;
  qualified: number;
  drafts_ready: number;
  failures: number;
  rejected: number;
};
type Data = {
  settings: Config;
  leads: Pick<
    Row<"leads">,
    "id" | "company_name" | "website" | "email" | "phone" | "source"
  >[];
  runs: Run[];
  candidates: Row<"autopilot_candidates">[];
  usage: Row<"autopilot_usage">[];
  jobs: {
    id: string;
    status: string;
    last_error: string | null;
    next_action_at: string;
    kind: string;
  }[];
  scheduler: { enabled: boolean; schedule?: string };
  nextWake: string | null;
  day: string;
  errors: string[];
  canManage: boolean;
  providerConfigured: boolean;
  delivery: string;
};
const usd = (n: number) =>
  new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
  }).format(n);
const stateNames: Record<string, string> = {
  discovered: "În cercetare",
  duplicate: "Duplicat",
  rejected: "Respins",
  qualified: "Calificat",
  drafted: "Ciornă pregătită",
  failed: "Eșuat",
  limited: "Limită zilnică",
};
export function AutopilotPage() {
  const [data, setData] = useState<Data | null>(null),
    [form, setForm] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [step, setStep] = useState(1),
    [view, setView] = useState("setup");
  async function reload(reset = false) {
    const response = await fetch("/api/autopilot", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Autopilot indisponibil.");
    setData(result);
    if (reset) setForm(result.settings);
  }
  useEffect(() => {
    let mounted = true;
    fetch("/api/autopilot", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (mounted) {
          setData(d);
          setForm(d.settings);
        }
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (!data?.settings.enabled) return;
    let mounted = true;
    const timer = setInterval(() => {
      fetch("/api/autopilot", { cache: "no-store" })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok)
            throw new Error(
              result.error || "Actualizarea progresului a eșuat.",
            );
          if (mounted) setData(result);
        })
        .catch((e) => {
          if (mounted) setError(e.message);
        });
    }, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [data?.settings.enabled]);
  async function act(action: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data: form }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await reload(true);
      setNotice(
        action === "save"
          ? "Setări salvate. Autopilot este în pauză; pornește-l după verificarea configurației."
          : action === "start"
            ? "Autopilot pornit. Scheduler-ul procesează coada fără browser."
            : action === "pause"
              ? "Autopilot în pauză. Un apel deja început poate termina; nu se revendică joburi noi."
              : "Procesare încheiată. Verifică istoricul și erorile.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare.");
    } finally {
      setBusy(false);
    }
  }
  if (!data || !form)
    return (
      <section className="panel skeleton" role="status">
        {error || "Se încarcă Autopilot…"}
      </section>
    );
  const today = data.runs.find((r) => r.day === data.day),
    usage = data.usage.find((u) => u.day === data.day);
  const next = data.nextWake;
  const lastRun = data.runs.find((r) => r.status === "completed");
  const writable = data.canManage && !busy;
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const activeJobs = data.jobs.filter((j) =>
    ["pending", "running", "retry"].includes(j.status),
  );
  const stage = activeJobs.some((j) => /discover/.test(j.kind))
    ? 0
    : activeJobs.length
      ? 2
      : data.candidates.length
        ? 3
        : -1;
  const textField = (label: string, key: "city" | "specialty") => (
    <label className="field">
      {label}
      <input
        required
        maxLength={100}
        value={form[key]}
        disabled={!writable}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  const numericField = (
    label: string,
    key:
      | "daily_target"
      | "daily_api_limit"
      | "daily_ai_budget_usd"
      | "provider_request_cost_usd"
      | "min_fit_score",
    min: number,
    max: number,
    step = 1,
  ) => (
    <label className="field">
      {label}
      <input
        type="number"
        required
        min={min}
        max={max}
        step={step}
        value={form[key]}
        disabled={!writable}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="autopilot-content" aria-busy={busy}>
      <nav className="subnav" aria-label="Lead Generation">
        <Button
          variant="ghost"
          className={view === "setup" ? "active" : ""}
          onClick={() => setView("setup")}
        >
          Căutare nouă
        </Button>
        <Button
          variant="ghost"
          className={view === "history" ? "active" : ""}
          onClick={() => setView("history")}
        >
          Istoric și rezultate
        </Button>
      </nav>
      <section className="panel autopilot-intro">
        <div>
          <h2>
            {data.settings.enabled ? "Autopilot activ" : "Autopilot în pauză"}
          </h2>
          <p className="muted">
            Leadurile tale → cercetare → calificare → o ciornă în română. Nicio
            aprobare, trimitere sau activare de campanie.
          </p>
        </div>
        <div className="autopilot-actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => reload().catch((e) => setError(e.message))}
          >
            Actualizează
          </Button>
          <Button
            variant="secondary"
            disabled={!writable || !data.settings.enabled}
            onClick={() => act("pause")}
          >
            Pauză
          </Button>
        </div>
        <details className="run-summary">
          <summary>Stare, programare și configurare email</summary>
          <p className="muted">
            Producție · numai date Autopilot ·{" "}
            {data.delivery === "log"
              ? "Email: log"
              : "Email: configurație invalidă"}{" "}
            · sursă:{" "}
            {data.settings.input_mode === "supplied"
              ? "leaduri furnizate de tine"
              : "Brave Search"}{" "}
            · răspunsuri: contact@voxatech.ro
          </p>
          <p>
            Ultima rulare zilnică reușită:{" "}
            {lastRun ? lastRun.day : "Nicio rulare finalizată"}. Ultimul job
            reușit:{" "}
            {data.settings.last_success_at
              ? dateTime(data.settings.last_success_at)
              : "Niciun job reușit"}
            . Următoarea trezire:{" "}
            {next
              ? dateTime(next)
              : data.scheduler.enabled
                ? "Scheduler disponibil; descoperire în pauză"
                : "Scheduler neconfigurat"}{" "}
            (Europe/Bucharest).
          </p>
        </details>
        {view === "setup" && step === 3 && data.errors.length > 0 && (
          <div role="status">
            <strong>Configurare necesară</strong>
            <ul>
              {data.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {!data.scheduler.enabled && (
          <p role="status">
            Scheduler neconfigurat. Administratorul trebuie să configureze
            Supabase Cron pentru acest proiect.
          </p>
        )}
        {!data.canManage && (
          <p>Ai acces de vizualizare. Setările cer rol owner/admin.</p>
        )}
        {(error || data.settings.last_error) && (
          <p role="alert">{error || data.settings.last_error}</p>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      {(data.settings.enabled ||
        activeJobs.length > 0 ||
        today?.status === "completed") && (
        <section className="surface" role="status">
          <ol className="pipeline-progress">
            {[
              "Searching companies",
              "Finding contacts",
              "Verifying data",
              "Complete",
            ].map((label, i) => (
              <li
                key={label}
                className={
                  i === stage || (stage === 2 && i === 1) ? "active" : ""
                }
              >
                <span />
                {label}
              </li>
            ))}
          </ol>
          <p className="helper-text">
            Starea reflectă joburile persistate. Cercetarea contactelor și
            verificarea datelor sunt procesate împreună.
          </p>
        </section>
      )}
      <div hidden={view !== "history"} className="metrics autopilot-metrics">
        {[
          ["Preluate", today?.discovered || 0],
          ["Duplicate", today?.duplicates || 0],
          ["Calificate azi", usage?.qualified || 0],
          ["Ciorne pregătite", today?.drafts_ready || 0],
          ["Joburi eșuate", today?.failures || 0],
          [
            "Cost estimat azi",
            usd((usage?.ai_cost_usd || 0) + (usage?.provider_cost_usd || 0)),
          ],
        ].map(([label, value]) => (
          <div key={label} className="panel metric">
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
          </div>
        ))}
      </div>
      <p hidden={view !== "history"} className="muted">
        Cost conservator în USD: AI + căutare; apelurile cu rezultat incert
        păstrează rezervarea maximă. Nu este factura furnizorilor. Cercetarea și
        ciornele din metrici aparțin descoperirii de azi; „calificate azi”
        folosește plafonul zilei curente.
      </p>
      <section hidden={view !== "setup"} className="panel autopilot-setup">
        <ol className="wizard-steps" aria-label="Pașii căutării">
          {["Ce cauți?", "Câte lead-uri?", "Start Search"].map((label, i) => (
            <li
              key={label}
              className={
                step === i + 1 ? "current" : step > i + 1 ? "done" : ""
              }
              aria-current={step === i + 1 ? "step" : undefined}
            >
              <span>{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <h2>
          {step === 1
            ? "Ce clinici vrei să abordezi?"
            : step === 2
              ? "Stabilește limitele lotului"
              : "Verifică înainte de pornire"}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act("save");
          }}
          noValidate
          className="autopilot-form"
        >
          <div className="autopilot-step" hidden={step !== 1}>
            <label className="field">
              Sursa leadurilor
              <select
                value={form.input_mode}
                disabled={!writable}
                onChange={(e) =>
                  setForm({ ...form, input_mode: e.target.value })
                }
              >
                <option value="supplied">Leadurile furnizate de mine</option>
                <option value="brave_search">
                  Descoperire Brave Search (opțional)
                </option>
              </select>
            </label>
            {textField("Oraș în România", "city")}
            {textField("Specialitate", "specialty")}
            <label className="field">
              Tip companie
              <input value="Clinici" readOnly />
            </label>
            <p className="helper-text">
              Poți folosi leadurile importate de tine. Căutarea online este
              opțională și necesită un furnizor configurat.
            </p>
          </div>
          <div className="autopilot-step" hidden={step !== 2}>
            {numericField(
              "Leaduri calificate / zi (max. 10)",
              "daily_target",
              1,
              10,
            )}
            {form.input_mode === "brave_search" &&
              numericField(
                "Cereri Brave / zi (max. 10)",
                "daily_api_limit",
                1,
                10,
              )}
            {numericField(
              "Buget AI zilnic, USD",
              "daily_ai_budget_usd",
              0,
              100,
              0.01,
            )}
            {form.input_mode === "brave_search" &&
              numericField(
                "Cost Brave per cerere, USD",
                "provider_request_cost_usd",
                0.001,
                1,
                0.001,
              )}
            {numericField("Scor minim de potrivire", "min_fit_score", 0, 100)}
            <fieldset className="autopilot-checks">
              <legend>Detalii necesare</legend>
              {[
                ["require_website", "Doar clinici cu site oficial (opțional)"],
                ["require_email", "Email valid (furnizat sau public)"],
                ["require_phone", "Telefon valid (furnizat sau public)"],
              ].map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={form[key as "require_email"]}
                    disabled={!writable}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {form.input_mode === "brave_search" && (
              <label className="autopilot-checks">
                <input
                  type="checkbox"
                  checked={form.storage_rights_confirmed}
                  disabled={!writable}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      storage_rights_confirmed: e.target.checked,
                    })
                  }
                />
                Confirm că planul meu Brave permite stocarea rezultatelor API.
              </label>
            )}
            <p className="muted">
              Dacă există un site, cercetăm maximum două pagini. Fără site,
              folosim datele furnizate, iar încrederea cercetării este 0%.
              Informațiile lipsă rămân necunoscute. Datele de contact furnizate
              de tine sunt marcate separat de cele găsite pe site. Gemini
              folosește modelul și tarifele din Setări. În modul cu leadurile
              tale nu există cost de căutare.
            </p>
            {form.input_mode === "supplied" && (
              <fieldset className="autopilot-checks">
                <legend>
                  Leaduri pentru Autopilot ({form.selected_lead_ids.length}/100
                  selectate)
                </legend>
                <p>
                  Importă leadurile din pagina Leaduri, apoi selectează-le aici.
                  Datele demo și leadurile refuzate sunt excluse. Fiecare lead
                  este procesat o singură dată.
                </p>
                {data.leads.map((l) => (
                  <label key={l.id}>
                    <input
                      type="checkbox"
                      disabled={
                        !writable ||
                        (!form.selected_lead_ids.includes(l.id) &&
                          form.selected_lead_ids.length >= 100)
                      }
                      checked={form.selected_lead_ids.includes(l.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          selected_lead_ids: e.target.checked
                            ? [...form.selected_lead_ids, l.id]
                            : form.selected_lead_ids.filter(
                                (id) => id !== l.id,
                              ),
                        })
                      }
                    />
                    {l.company_name} ·{" "}
                    {validProspectEmail(l.email)
                      ? l.email
                      : "email necunoscut / invalid"}{" "}
                    · {l.source || "sursă necunoscută"}
                  </label>
                ))}
                {!data.leads.length && (
                  <p>
                    Nu există leaduri eligibile.{" "}
                    <Link href="/leads">Importă leadurile tale</Link>.
                  </p>
                )}
              </fieldset>
            )}
          </div>
          <div className="autopilot-step" hidden={step !== 3}>
            <dl className="review-summary">
              <div>
                <dt>Țintă</dt>
                <dd>
                  {form.specialty} · {form.city}
                </dd>
              </div>
              <div>
                <dt>Limită zilnică</dt>
                <dd>{form.daily_target} leaduri</dd>
              </div>
              <div>
                <dt>Buget AI zilnic</dt>
                <dd>{usd(form.daily_ai_budget_usd)}</dd>
              </div>
              <div>
                <dt>Sursă</dt>
                <dd>
                  {form.input_mode === "supplied"
                    ? `${form.selected_lead_ids.length} leaduri selectate`
                    : "Brave Search"}
                </dd>
              </div>
            </dl>
            <p className="helper-text">
              Voxa cercetează site-urile, califică leadurile și pregătește
              ciorne. Emailurile rămân în modul log.
            </p>
            {dirty && (
              <p role="status" className="helper-text">
                Salvează configurația pentru a activa Start Search.
              </p>
            )}
            <Button type="submit" disabled={!writable}>
              Salvează configurația
            </Button>
          </div>
          <div className="wizard-footer">
            <Button
              type="button"
              variant="secondary"
              disabled={step === 1 || busy}
              onClick={() => setStep(step - 1)}
            >
              Înapoi
            </Button>
            <span className="helper-text">Pasul {step} din 3</span>
            {step < 3 && (
              <Button
                type="button"
                disabled={busy}
                onClick={() => setStep(step + 1)}
              >
                Continuă
              </Button>
            )}
            {step === 3 && (
              <Button
                type="button"
                disabled={
                  !writable ||
                  dirty ||
                  data.settings.enabled ||
                  data.errors.length > 0 ||
                  !data.scheduler.enabled
                }
                onClick={() => act("start")}
              >
                Start Search
              </Button>
            )}
          </div>
        </form>
      </section>
      <section hidden={view !== "history"} className="panel">
        <h2>Istoricul rulărilor</h2>
        <div className="autopilot-table">
          <table>
            <thead>
              <tr>
                {[
                  "Zi",
                  "Stare",
                  "Preluate",
                  "Duplicate",
                  "Calificate",
                  "Ciorne",
                  "Respinse",
                  "Eșecuri",
                  "Cost USD",
                ].map((t) => (
                  <th key={t} scope="col">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => {
                const u = data.usage.find((u) => u.day === r.day);
                return (
                  <tr key={r.id}>
                    <th scope="row">{r.day}</th>
                    <td>{r.status}</td>
                    <td>{r.discovered}</td>
                    <td>{r.duplicates}</td>
                    <td>{r.qualified}</td>
                    <td>{r.drafts_ready}</td>
                    <td>{r.rejected}</td>
                    <td>{r.failures}</td>
                    <td>
                      {usd((u?.ai_cost_usd || 0) + (u?.provider_cost_usd || 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.runs.length === 0 && (
          <p className="muted">
            Nicio procesare executată. Datele demo/evaluare din CRM nu sunt
            incluse.
          </p>
        )}
      </section>
      <section hidden={view !== "history"} className="panel">
        <h2>Surse și dovezi recente</h2>
        <p className="muted">
          Scorul de potrivire măsoară ținta comercială. Încrederea măsoară
          completitudinea dovezilor, separat.
        </p>
        <div className="autopilot-table">
          <table>
            <thead>
              <tr>
                {[
                  "Site / prospect",
                  "Descoperit",
                  "Stare",
                  "Potrivire",
                  "Încredere",
                  "Dovezi / eroare",
                ].map((t) => (
                  <th key={t} scope="col">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.candidates.slice(0, 100).map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.source_url ? (
                      <a href={c.source_url} target="_blank" rel="noreferrer">
                        {c.domain || c.provider_title}
                      </a>
                    ) : (
                      <>
                        <strong>{c.provider_title}</strong>
                        <small>Fără site · date furnizate</small>
                      </>
                    )}
                    {c.lead_id && (
                      <div>
                        <Link href={`/leads/${c.lead_id}`}>
                          Vezi prospectul și ciorna
                        </Link>
                      </div>
                    )}
                  </td>
                  <td>{dateTime(c.discovered_at)}</td>
                  <td>{stateNames[c.state]}</td>
                  <td>{c.fit_score ?? "Necunoscut"}</td>
                  <td>
                    {c.confidence === null ? "Necunoscut" : `${c.confidence}%`}
                  </td>
                  <td>
                    {c.last_error || "—"}
                    {c.research && (
                      <details>
                        <summary>Cercetare verificabilă</summary>
                        <pre>{JSON.stringify(c.research, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.candidates.length && (
          <p className="muted">Niciun lead preluat încă.</p>
        )}
      </section>
      <section hidden={view !== "history"} className="panel">
        <h2>Coada și erorile</h2>
        {data.jobs
          .filter((j) => j.status !== "completed")
          .slice(0, 30)
          .map((j) => (
            <p key={j.id}>
              {j.kind} · {j.status} · {dateTime(j.next_action_at)} ·{" "}
              {j.last_error || "În așteptare"}
            </p>
          ))}
        {!data.jobs.length && <p className="muted">Niciun job Autopilot.</p>}
        <Button
          variant="secondary"
          disabled={!writable || !data.settings.enabled}
          onClick={() => act("process")}
        >
          Procesează un job acum
        </Button>
      </section>
    </div>
  );
}
