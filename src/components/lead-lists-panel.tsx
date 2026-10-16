"use client";
import { useState } from "react";
import type { Snapshot } from "@/lib/snapshot";
import { Button } from "./ui/button";
export function LeadListsPanel({
  data,
  activeId,
  onSelect,
  selectedIds,
  act,
  canEdit,
}: {
  data: Snapshot;
  activeId: string;
  onSelect: (id: string) => void;
  selectedIds: string[];
  act: (action: string, input: unknown) => Promise<unknown>;
  canEdit: boolean;
}) {
  const [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const counts = new Map<string, number>();
  for (const lead of data.leads)
    counts.set(
      lead.lead_list_id || "unassigned",
      (counts.get(lead.lead_list_id || "unassigned") || 0) + 1,
    );
  return (
    <section
      className="panel panel-body section-gap"
      aria-label="Campanii cu leaduri"
    >
      <div className="gmail-section-head">
        <div>
          <h2>Campaniile tale</h2>
          <p>
            O listă pentru fiecare nișă. Importă aici 1.000–2.000 de leaduri,
            apoi alege campania din Autopilot.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!canEdit || busy}
          onClick={() => setCreating(!creating)}
        >
          Campanie nouă
        </Button>
      </div>
      <label className="field">
        Campanie
        <select
          value={activeId}
          disabled={busy}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">Toate campaniile · {data.leads.length}</option>
          <option value="unassigned">
            Fără campanie · {counts.get("unassigned") || 0}
          </option>
          {data.lead_lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name} · {counts.get(list.id) || 0} leaduri
            </option>
          ))}
        </select>
      </label>
      {!!selectedIds.length && (
        <Button
          className="section-gap"
          variant="secondary"
          disabled={
            !canEdit || busy || !activeId || data.gmail_autopilot_enabled
          }
          onClick={async () => {
            setBusy(true);
            try {
              const result = await act("lead_list_assign", {
                ids: selectedIds,
                lead_list_id: activeId === "unassigned" ? null : activeId,
              });
              setNotice(
                result
                  ? "Leadurile selectate au fost mutate în campanie."
                  : "Mutarea nu a reușit. Pune Autopilot în pauză și reîncearcă.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Mută cele {selectedIds.length} leaduri selectate aici
        </Button>
      )}
      {creating && (
        <form
          className="section-gap"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const values = new FormData(form);
            setBusy(true);
            try {
              const result = (await act("lead_list_create", {
                name: values.get("name"),
                niche: values.get("niche"),
              })) as { id?: string } | null;
              if (result?.id) {
                onSelect(result.id);
                setCreating(false);
                setNotice(
                  "Campanie creată. Folosește Import Excel / CSV pentru a adăuga leadurile.",
                );
              } else
                setNotice(
                  "Nu am putut crea campania. Verifică dacă numele există deja.",
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label className="field">
              Numele campaniei
              <input
                name="name"
                placeholder="Stomatologie · Brașov"
                required
                minLength={2}
                maxLength={160}
                disabled={busy}
              />
            </label>
            <label className="field">
              Nișă
              <input
                name="niche"
                placeholder="Stomatologie, kinetoterapie…"
                maxLength={100}
                disabled={busy}
              />
            </label>
          </div>
          <Button className="section-gap" disabled={busy}>
            Creează campania
          </Button>
        </form>
      )}
      {notice && (
        <p className="helper-text section-gap" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
