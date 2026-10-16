"use client";
import Link from "next/link";
import { Search, ArrowRight, Activity } from "lucide-react";
import { AnimatedValue } from "./ambient";
import type { Snapshot } from "@/lib/snapshot";
import { dateTime } from "@/lib/domain";
export function GrowthDashboard({ data }: { data: Snapshot }) {
  const production = data.leads.filter(
    (l) =>
      !/demo|dry.run|controlled.test|evaluare-controlata/i.test(l.source || ""),
  );
  const ids = new Set(production.map((l) => l.id));
  const messages = data.messages.filter((m) => ids.has(m.lead_id));
  const contacted = new Set(
    messages
      .filter(
        (m) =>
          m.direction === "outbound" &&
          m.provider !== "local-dry-run" &&
          m.sent_at &&
          (m.status === "delivered" ||
            m.status === "opened" ||
            m.status === "sent") &&
          !(
            m.metadata &&
            typeof m.metadata === "object" &&
            !Array.isArray(m.metadata) &&
            (m.metadata.delivery_mode === "log" ||
              m.metadata.simulated === true)
          ),
      )
      .map((m) => m.lead_id),
  ).size;
  const replied = new Set(
    messages.filter((m) => m.direction === "inbound").map((m) => m.lead_id),
  ).size;
  const qualified = production.filter((l) =>
    [
      "QUALIFIED",
      "DEMO_GENERATING",
      "DEMO_SENT",
      "TRIAL",
      "CHECKOUT_SENT",
      "WON",
    ].includes(l.status),
  ).length;
  const won = production.filter((l) => l.status === "WON").length;
  const stages = [
    ["Lead-uri găsite", production.length],
    ["Lead-uri contactate", contacted],
    ["Răspunsuri primite", replied],
    ["Lead-uri calificate", qualified],
    ["Conversii / clienți", won],
  ] as const;
  const events = data.activities
    .filter((a) => a.lead_id && ids.has(a.lead_id))
    .slice(0, 5);
  const names: Record<string, string> = {
    insert: "Lead adăugat",
    update: "Lead actualizat",
    ai_research: "Cercetare finalizată",
    ai_outreach: "Ciornă pregătită",
    email_sent: "Email trimis",
    autopilot_ai_research: "Cercetare finalizată",
    autopilot_ai_draft: "Ciornă pregătită",
    message_approve: "Mesaj aprobat",
  };
  return (
    <div className="dashboard-simple">
      <section className="next-step">
        <div>
          <h2>Următoarea conversație începe aici.</h2>
          <p>
            Găsește clinici potrivite, pregătește mesajele și urmărește
            răspunsurile.
          </p>
        </div>
        <Link className="button primary" href="/autopilot">
          <Search size={16} />
          Găsește lead-uri
        </Link>
      </section>
      <section className="kpi-strip" aria-label="Rezultate în producție">
        {stages.map(([label, value]) => (
          <div className="kpi" key={label}>
            <span>{label}</span>
            <strong>
              <AnimatedValue value={value} />
            </strong>
          </div>
        ))}
      </section>
      <p className="scope-note">
        Date de producție. Leadurile demo și evaluările controlate sunt excluse.{" "}
        <Link href="/leads">Vezi toate leadurile</Link>
      </p>
      <section className="surface funnel-simple">
        <div className="section-heading">
          <div>
            <h2>De la lead la client</h2>
            <p>Etapele atinse în procesul de vânzare.</p>
          </div>
          <Link className="text-link" href="/analytics">
            Analytics <ArrowRight size={14} />
          </Link>
        </div>
        <ol>
          {stages.map(([label, value], index) => (
            <li key={label}>
              <span className="funnel-index">{index + 1}</span>
              <div>
                <strong>{value}</strong>
                <span>{label.replace("Lead-uri ", "")}</span>
                <div className="funnel-track">
                  <i
                    style={{
                      width: `${production.length ? Math.min(100, (value / production.length) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="recent-activity">
        <div className="section-heading">
          <h2>Activitate recentă</h2>
          <Activity size={17} />
        </div>
        {events.length ? (
          events.map((a) => (
            <div className="recent-row" key={a.id}>
              <span className="event-dot" />
              <div>
                <strong>{names[a.action] || "Activitate înregistrată"}</strong>
                <p>
                  {production.find((l) => l.id === a.lead_id)?.company_name}
                </p>
              </div>
              <time dateTime={a.created_at}>{dateTime(a.created_at)}</time>
            </div>
          ))
        ) : (
          <div className="quiet-empty">
            <p>Activitatea leadurilor tale va apărea aici.</p>
            <Link href="/autopilot" className="text-link">
              Începe cu primul lot <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
