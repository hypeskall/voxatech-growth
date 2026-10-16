"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { leadInput } from "@/lib/domain";
import {
  importFields,
  guessMapping,
  mappedLead,
  maxSpreadsheetBytes,
  sheetRecords,
  spreadsheetAccept,
  type SpreadsheetData,
} from "@/lib/lead-spreadsheet";
import { Modal } from "./ui/dialog";
import { Button } from "./ui/button";
import { Table } from "./ui/table";
type Report = { inserted: number; errors: { row: number; error: string }[] };
export function ImportDialog({
  open,
  close,
  onImport,
  leadLists = [],
  initialListId = "",
  onComplete,
}: {
  open: boolean;
  close: () => void;
  onImport: (data: unknown) => Promise<unknown>;
  leadLists?: { id: string; name: string }[];
  initialListId?: string;
  onComplete?: () => Promise<void>;
}) {
  const [listId, setListId] = useState(initialListId);
  const [book, setBook] = useState<SpreadsheetData | null>(null);
  const [filename, setFilename] = useState("");
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [processed, setProcessed] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [progress, setProgress] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  function stopReader() {
    generation.current++;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
  }
  useEffect(
    () => () => {
      generation.current++;
      workerRef.current?.terminate();
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  function resetSelection() {
    setExcluded(new Set());
    setProcessed(new Set());
    setReport(null);
    setError("");
    setPage(0);
  }
  function chooseSheet(
    next: SpreadsheetData,
    index: number,
    header = next.sheets[index].headerRow,
  ) {
    setSheetIndex(index);
    setHeaderRow(header);
    setMapping(guessMapping(sheetRecords(next.sheets[index], header).headers));
    resetSelection();
  }
  function dismiss() {
    if (busy) return;
    stopReader();
    setBook(null);
    setFilename("");
    setLoading(false);
    resetSelection();
    close();
  }
  async function loadFile(file: File) {
    stopReader();
    const current = generation.current;
    setBook(null);
    setFilename(file.name);
    resetSelection();
    setLoading(false);
    if (file.size > maxSpreadsheetBytes) {
      setError("Fișierul trebuie să aibă maximum 10 MB.");
      return;
    }
    setLoading(true);
    try {
      const bytes = await file.arrayBuffer();
      if (generation.current !== current) return;
      const worker = new Worker(
        new URL("../lib/spreadsheet.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      const finish = () => {
        worker.terminate();
        workerRef.current = null;
        if (timerRef.current) clearTimeout(timerRef.current);
        setLoading(false);
      };
      worker.onmessage = (
        event: MessageEvent<{ data?: SpreadsheetData; error?: string }>,
      ) => {
        if (generation.current !== current) return;
        finish();
        if (event.data.error) {
          setError(event.data.error);
          return;
        }
        if (event.data.data) {
          const data = event.data.data;
          const detected = data.sheets.findIndex(
            (s) =>
              !s.error &&
              guessMapping(sheetRecords(s, s.headerRow).headers).company_name,
          );
          const first =
            detected >= 0
              ? detected
              : Math.max(
                  0,
                  data.sheets.findIndex(
                    (s) => !s.error && s.rows.some((r) => r.some(Boolean)),
                  ),
                );
          setBook(data);
          chooseSheet(data, first);
        }
      };
      worker.onerror = () => {
        if (generation.current === current) {
          finish();
          setError(
            "Nu am putut citi fișierul. Verifică formatul și elimină parola, dacă există.",
          );
        }
      };
      timerRef.current = setTimeout(() => {
        if (generation.current === current) {
          finish();
          setError(
            "Citirea a durat prea mult. Împarte fișierul în fișiere mai mici.",
          );
        }
      }, 30000);
      worker.postMessage({ bytes, filename: file.name }, [bytes]);
    } catch {
      if (generation.current === current) {
        stopReader();
        setLoading(false);
        setError("Nu am putut deschide fișierul ales.");
      }
    }
  }
  const sheet = book?.sheets[sheetIndex];
  const table = useMemo(
    () =>
      sheet ? sheetRecords(sheet, headerRow) : { headers: [], records: [] },
    [sheet, headerRow],
  );
  const entries = useMemo(
    () =>
      table.records.map((row) => {
        const values = mappedLead(row, mapping, filename);
        const result = leadInput.safeParse(values);
        const problem = result.success
          ? ""
          : result.error.issues
              .map((issue) => {
                const field =
                  importFields.find(([key]) => key === issue.path[0])?.[1] ||
                  "Date";
                return `${field.replace(" *", "")}: valoare lipsă sau invalidă`;
              })
              .join("; ");
        return {
          row: row.row,
          values,
          data: result.success ? result.data : null,
          problem,
        };
      }),
    [table, mapping, filename],
  );
  const pending = entries.filter(
    (r) => r.data && !excluded.has(r.row) && !processed.has(r.row),
  );
  const invalid = entries.filter((r) => !r.data).length;
  const pages = Math.max(1, Math.ceil(entries.length / 10));
  const duplicateMapping =
    Object.values(mapping).filter(Boolean).length !==
    new Set(Object.values(mapping).filter(Boolean)).size;
  const locked = busy || loading;
  async function importSelected() {
    setBusy(true);
    setError("");
    let aggregate = report || { inserted: 0, errors: [] };
    const completed = new Set(processed);
    try {
      for (let offset = 0; offset < pending.length; offset += 100) {
        const batch = pending.slice(offset, offset + 100);
        setProgress(
          `Se importă ${offset + 1}–${Math.min(offset + 100, pending.length)} din ${pending.length}…`,
        );
        const rows = batch.map((r) => r.data);
        const result = (await onImport(
          listId ? { rows, lead_list_id: listId } : rows,
        )) as Report | null;
        if (
          !result ||
          typeof result.inserted !== "number" ||
          !Array.isArray(result.errors)
        )
          throw new Error(
            "Importul s-a întrerupt. Rândurile deja procesate sunt păstrate; poți continua cu cele rămase.",
          );
        aggregate = {
          inserted: aggregate.inserted + result.inserted,
          errors: [
            ...aggregate.errors,
            ...result.errors.map((e) => ({
              row: batch[e.row - 1]?.row || e.row,
              error: e.error,
            })),
          ],
        };
        batch.forEach((row) => completed.add(row.row));
        setProcessed(new Set(completed));
        setReport(aggregate);
      }
      setProgress("Import finalizat.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Import nereușit.");
    } finally {
      if (onComplete) {
        try {
          await onComplete();
        } catch {
          setError(
            "Importul a fost procesat, dar lista nu s-a actualizat. Reîncarcă pagina înainte de a continua.",
          );
        }
      }
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={dismiss}
      title="Importă prospecte din Excel sau CSV"
    >
      <p className="muted" id="import-help">
        Alege fișierul, verifică foaia și coloanele, apoi confirmă prospectele.
        Duplicatele existente sunt omise. Importul nu pornește trimiterea
        emailurilor.
      </p>
      <label className="field section-gap">
        Campania pentru aceste leaduri
        <select
          value={listId}
          disabled={busy || processed.size > 0}
          onChange={(e) => setListId(e.target.value)}
        >
          <option value="">Fără campanie</option>
          {leadLists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field section-gap">
        Fișier Excel, CSV sau ODS · maximum 10 MB
        <input
          type="file"
          accept={spreadsheetAccept}
          disabled={locked}
          aria-describedby="import-help import-error"
          aria-invalid={!!error}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void loadFile(file);
          }}
        />
      </label>
      <p className="helper-text">
        XLSX, XLS, XLSM, XLSB, XLTX, XLTM, XLT, XML, CSV, TSV, ODS. Maximum
        5.000 de prospecte pe foaie. Fișierele cu parolă trebuie deblocate în
        Excel.
      </p>
      {loading && <p role="status">Se citește {filename}…</p>}
      {book && sheet && (
        <>
          <div className="form-grid section-gap">
            <label className="field">
              Foaie de calcul
              <select
                disabled={busy}
                value={sheetIndex}
                onChange={(e) => chooseSheet(book, Number(e.target.value))}
              >
                {book.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                    {s.error ? " · verifică dimensiunea" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Rândul cu numele coloanelor
              <select
                disabled={busy || !!sheet.error}
                value={headerRow}
                onChange={(e) =>
                  chooseSheet(book, sheetIndex, Number(e.target.value))
                }
              >
                <option value={-1}>Fără antet · include primul rând</option>
                {sheet.rows.slice(0, 30).map((_, i) => (
                  <option key={i} value={i}>
                    Rând {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {sheet.error ? (
            <p role="alert" className="error-text">
              {sheet.error}
            </p>
          ) : (
            <>
              <div className="form-grid section-gap">
                {importFields.map(([key, label]) => (
                  <label className="field" key={key}>
                    {label}
                    <select
                      disabled={busy || processed.size > 0}
                      value={mapping[key] || ""}
                      required={key === "company_name"}
                      aria-describedby="import-mapping-help"
                      onChange={(e) => {
                        setMapping({ ...mapping, [key]: e.target.value });
                        setPage(0);
                        setExcluded(new Set());
                      }}
                    >
                      <option value="">
                        {key === "company_name"
                          ? "Alege coloana companiei"
                          : "Ignoră coloana"}
                      </option>
                      {table.headers.map((h) => (
                        <option key={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <p className="helper-text" id="import-mapping-help">
                Compania este obligatorie. Corectează coloanele dacă este
                nevoie. Pentru celule cu mai multe emailuri folosim prima
                adresă; verific-o în previzualizare.
              </p>
              {duplicateMapping && (
                <p role="alert" className="error-text">
                  Aceeași coloană este folosită de mai multe ori. Alege o
                  coloană diferită pentru fiecare câmp.
                </p>
              )}
              <h3 className="section-title">
                Previzualizare · {entries.length} rânduri · {pending.length}{" "}
                selectate
              </h3>
              <p className="helper-text">
                {invalid} rânduri invalide vor fi omise. Poți importa o altă
                foaie separat după finalizare.
              </p>
              <div className="actions section-gap">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setExcluded(new Set())}
                >
                  Selectează toate rândurile valide
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    setExcluded(new Set(entries.map((r) => r.row)))
                  }
                >
                  Deselectează toate
                </Button>
              </div>
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Importă</th>
                    <th scope="col">Rând</th>
                    <th scope="col">Companie</th>
                    <th scope="col">Oraș</th>
                    <th scope="col">Email / verificare</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(page * 10, page * 10 + 10).map((entry) => (
                    <tr key={entry.row}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Importă rândul ${entry.row}: ${entry.values.company_name || "fără companie"}`}
                          checked={
                            !!entry.data &&
                            !excluded.has(entry.row) &&
                            !processed.has(entry.row)
                          }
                          disabled={
                            busy || !entry.data || processed.has(entry.row)
                          }
                          onChange={(e) => {
                            const next = new Set(excluded);
                            if (e.target.checked) next.delete(entry.row);
                            else next.add(entry.row);
                            setExcluded(next);
                          }}
                        />
                      </td>
                      <td>{entry.row}</td>
                      <td>{entry.values.company_name || "—"}</td>
                      <td>{entry.values.city || "—"}</td>
                      <td>
                        {entry.values.email || "Fără email"}
                        {entry.problem && (
                          <p className="error-text">{entry.problem}</p>
                        )}
                        {processed.has(entry.row) && <p>Procesat</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="actions section-gap">
                <Button
                  variant="secondary"
                  disabled={page === 0 || busy}
                  onClick={() => setPage(page - 1)}
                >
                  Înapoi
                </Button>
                <span>
                  Pagina {page + 1} din {pages}
                </span>
                <Button
                  variant="secondary"
                  disabled={page + 1 >= pages || busy}
                  onClick={() => setPage(page + 1)}
                >
                  Înainte
                </Button>
              </div>
            </>
          )}
        </>
      )}
      <p
        id="import-error"
        role={error ? "alert" : undefined}
        className="error-text"
      >
        {error}
      </p>
      {report && (
        <div className="notice section-gap" role="status">
          <div>
            {report.inserted} prospecte importate. {report.errors.length}{" "}
            rânduri omise de server (inclusiv duplicate).
            {report.errors.slice(0, 20).map((e) => (
              <p key={e.row}>
                Rând {e.row}: {e.error}
              </p>
            ))}
          </div>
        </div>
      )}
      <p role="status" aria-live="polite">
        {busy || report ? progress : ""}
      </p>
      <div className="form-actions">
        <Button variant="secondary" disabled={busy} onClick={dismiss}>
          Închide
        </Button>
        <Button
          disabled={
            locked ||
            !pending.length ||
            !mapping.company_name ||
            duplicateMapping ||
            !!sheet?.error
          }
          onClick={importSelected}
        >
          {busy ? "Se importă…" : `Importă ${pending.length} prospecte`}
        </Button>
      </div>
    </Modal>
  );
}
