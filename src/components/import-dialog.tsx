"use client";
import { useState } from "react";
import Papa from "papaparse";
import { Modal } from "./ui/dialog";
import { Button } from "./ui/button";
import { Table } from "./ui/table";
const fields = [
  ["company_name", "Companie *"],
  ["niche", "Specialitate"],
  ["city", "Oraș"],
  ["website", "Site web"],
  ["email", "Email"],
  ["phone", "Telefon"],
  ["contact_name", "Persoană de contact"],
  ["google_rating", "Evaluare Google"],
  ["review_count", "Număr recenzii"],
  ["notes", "Adresă / notițe"],
] as const;
export function ImportDialog({
  open,
  close,
  onImport,
}: {
  open: boolean;
  close: () => void;
  onImport: (data: unknown) => Promise<unknown>;
}) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [report, setReport] = useState<{
    inserted: number;
    errors: { row: number; error: string }[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const headers = Object.keys(rows[0] || {});
  return (
    <Modal open={open} onOpenChange={close} title="Importă prospecte din CSV">
      <p className="muted" style={{ fontSize: 14, marginBottom: 20 }}>
        Mapează coloanele și verifică primele rânduri. Importul identifică
        duplicatele după email, telefon, site și companie + oraș.
      </p>
      <label className="field">
        Fișier CSV · maximum 500 de rânduri
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 1000000) {
              setError("Fișierul trebuie să fie sub 1 MB.");
              return;
            }
            setReport(null);
            Papa.parse<Record<string, string>>(f, {
              header: true,
              skipEmptyLines: "greedy",
              complete: (r) => {
                if (r.errors.length) {
                  setError("CSV invalid: " + r.errors[0].message);
                  return;
                }
                if (r.data.length > 500) {
                  setError(
                    "Împarte fișierul în loturi de cel mult 500 de rânduri.",
                  );
                  return;
                }
                setError("");
                setRows(r.data);
                setMapping(
                  Object.fromEntries(
                    fields.map(([key, label]) => [
                      key,
                      Object.keys(r.data[0] || {}).find(
                        (h) =>
                          h.toLowerCase() === key ||
                          h.toLowerCase() ===
                            label.replace(" *", "").toLowerCase(),
                      ) || "",
                    ]),
                  ),
                );
              },
            });
          }}
        />
      </label>
      {rows.length > 0 && (
        <>
          <div className="form-grid section-gap">
            {fields.map(([key, label]) => (
              <label className="field" key={key}>
                {label}
                <select
                  value={mapping[key] || ""}
                  onChange={(e) =>
                    setMapping({ ...mapping, [key]: e.target.value })
                  }
                >
                  <option value="">Ignoră coloana</option>
                  {headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <h3 className="section-title">
            Previzualizare · {rows.length} rânduri
          </h3>
          <Table>
            <thead>
              <tr>
                <th>Companie</th>
                <th>Oraș</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 5).map((r, i) => (
                <tr key={i}>
                  <td>{r[mapping.company_name] || "—"}</td>
                  <td>{r[mapping.city] || "—"}</td>
                  <td>{r[mapping.email] || "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
      {error && <p className="error-text">{error}</p>}
      {report && (
        <div className="notice section-gap">
          <div>
            {report.inserted} prospecte importate. {report.errors.length}{" "}
            rânduri neimportate.
            {report.errors.slice(0, 20).map((e) => (
              <p key={e.row}>
                Rând {e.row}: {e.error}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="form-actions">
        <Button variant="secondary" onClick={close}>
          Închide
        </Button>
        <Button
          disabled={busy || !rows.length || !mapping.company_name}
          onClick={async () => {
            setBusy(true);
            try {
              const values = rows.map((row) =>
                Object.fromEntries([
                  ...fields.map(([key]) => [
                    key,
                    row[mapping[key]]?.trim() || null,
                  ]),
                  ["source", "CSV"],
                  ["country", "RO"],
                  ["notes", row[mapping.notes]?.trim() || ""],
                ]),
              );
              const result = await onImport(values);
              if (result)
                setReport(
                  result as {
                    inserted: number;
                    errors: { row: number; error: string }[];
                  },
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Se importă…" : "Confirmă importul"}
        </Button>
      </div>
    </Modal>
  );
}
