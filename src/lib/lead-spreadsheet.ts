export const spreadsheetAccept =
  ".xlsx,.xls,.xlsm,.xlsb,.xltx,.xltm,.xlt,.xml,.ods,.csv,.tsv";
export const maxSpreadsheetBytes = 10 * 1024 * 1024;
export const maxSpreadsheetRows = 5000;
export const importFields = [
  [
    "company_name",
    "Companie *",
    [
      "company",
      "company name",
      "business name",
      "name",
      "nume",
      "nume firma",
      "firma",
      "companie",
      "clinica",
      "clinica cabinet",
      "cabinet",
      "nume clinica",
      "denumire cabinet",
      "denumire",
      "denumire firma",
    ],
  ],
  [
    "niche",
    "Specialitate",
    [
      "specialitate",
      "niche",
      "specialty",
      "category",
      "categorie",
      "industry",
      "domeniu",
    ],
  ],
  ["city", "Oraș", ["city", "oras", "localitate", "town"]],
  [
    "website",
    "Site web",
    ["website", "site", "site web", "web", "url", "domain", "domeniu web"],
  ],
  [
    "email",
    "Email",
    [
      "email",
      "e mail",
      "email address",
      "adresa email",
      "mail",
      "email 1",
      "emails",
    ],
  ],
  [
    "phone",
    "Telefon",
    [
      "telefon",
      "phone",
      "phone number",
      "telephone",
      "mobile",
      "mobil",
      "numar telefon",
      "tel",
    ],
  ],
  [
    "contact_name",
    "Persoană de contact",
    [
      "contact name",
      "contact",
      "persoana de contact",
      "nume contact",
      "contact nominal",
      "owner",
      "proprietar",
    ],
  ],
  [
    "google_rating",
    "Evaluare Google",
    ["google rating", "rating", "evaluare google", "nota", "evaluare"],
  ],
  [
    "review_count",
    "Număr recenzii",
    ["review count", "reviews", "numar recenzii", "recenzii", "reviews count"],
  ],
  [
    "notes",
    "Adresă / notițe",
    [
      "notes",
      "note",
      "notite",
      "adresa",
      "address",
      "full address",
      "observatii",
    ],
  ],
] as const;
export type ImportMapping = Record<string, string>;
export type SpreadsheetSheet = {
  name: string;
  rows: string[][];
  headerRow: number;
  error?: string;
};
export type SpreadsheetData = { sheets: SpreadsheetSheet[] };
export type ImportRow = { row: number; values: Record<string, string> };
const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function guessMapping(headers: string[]): ImportMapping {
  const used = new Set<string>();
  return Object.fromEntries(
    importFields.map(([key, , aliases]) => {
      const found =
        headers.find(
          (h) =>
            !used.has(h) &&
            [normalized(key), ...aliases].includes(normalized(h)),
        ) || "";
      if (found) used.add(found);
      return [key, found];
    }),
  );
}

export function detectHeaderRow(rows: string[][]): number {
  let best = rows.findIndex((row) => row.some((cell) => cell.trim()));
  let score = 0;
  rows.slice(0, 30).forEach((row, index) => {
    const mapping = guessMapping(row);
    const candidate =
      Object.values(mapping).filter(Boolean).length +
      (mapping.company_name ? 2 : 0) +
      (mapping.email ? 2 : 0);
    if (candidate > score) {
      score = candidate;
      best = index;
    }
  });
  return Math.max(0, best);
}

export function sheetRecords(sheet: SpreadsheetSheet, headerRow: number) {
  const width = Math.max(0, ...sheet.rows.map((r) => r.length));
  const used = new Set<string>();
  const headers = Array.from({ length: width }, (_, i) => {
    const base =
      (headerRow < 0 ? "" : sheet.rows[headerRow]?.[i]?.trim()) ||
      `Coloana ${i + 1}`;
    let value = base;
    let duplicate = 2;
    while (used.has(value)) value = `${base} (${duplicate++})`;
    used.add(value);
    return value;
  });
  const records: ImportRow[] = [];
  sheet.rows.forEach((row, index) => {
    if (index <= headerRow || !row.some((value) => value.trim())) return;
    // Repeated table headers are common in spreadsheet exports.
    if (
      headerRow >= 0 &&
      row.every((value, i) => value === sheet.rows[headerRow]?.[i])
    )
      return;
    records.push({
      row: index + 1,
      values: Object.fromEntries(headers.map((h, i) => [h, row[i] || ""])),
    });
  });
  return { headers, records };
}

export function mappedLead(
  row: ImportRow,
  mapping: ImportMapping,
  filename: string,
): Record<string, string | null> {
  const values: Record<string, string | null> = Object.fromEntries(
    importFields.map(([key]) => [
      key,
      row.values[mapping[key]]?.trim() || null,
    ]),
  );
  if (values.email) {
    values.email = (
      values.email
        .replace(/^mailto:/i, "")
        .match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ||
      values.email
    ).toLowerCase();
  }
  if (values.website && !/^[a-z][a-z0-9+.-]*:/i.test(values.website))
    values.website = `https://${values.website}`;
  if (values.google_rating)
    values.google_rating = values.google_rating.replace(",", ".");
  if (values.review_count)
    values.review_count = values.review_count.replace(/[\s.,]/g, "");
  return {
    ...values,
    source:
      (/\.(csv|tsv)$/i.test(filename) ? "CSV: " : "Excel: ") +
      filename.slice(0, 90),
    country: "RO",
    notes: values.notes || "",
  };
}

export async function parseSpreadsheet(
  bytes: ArrayBuffer,
  filename: string,
): Promise<SpreadsheetData> {
  if (
    !spreadsheetAccept
      .split(",")
      .some((ext) => filename.toLowerCase().endsWith(ext))
  )
    throw new Error("Alege un fișier Excel, CSV, TSV sau ODS.");
  if (!bytes.byteLength || bytes.byteLength > maxSpreadsheetBytes)
    throw new Error("Fișierul trebuie să aibă maximum 10 MB.");
  const { read, utils } = await import("xlsx");
  let workbook;
  try {
    workbook = read(bytes, {
      type: "array",
      dense: true,
      cellFormula: false,
      cellHTML: false,
      bookVBA: false,
      sheetRows: maxSpreadsheetRows + 32,
    });
  } catch {
    throw new Error(
      "Nu pot deschide fișierul. Verifică dacă este valid și fără parolă.",
    );
  }
  if (workbook.SheetNames.length > 40)
    throw new Error("Păstrează cel mult 40 de foi în fișierul de import.");
  let cells = 0;
  const sheets = workbook.SheetNames.map<SpreadsheetSheet>((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet["!ref"]) return { name, rows: [], headerRow: 0 };
    const fullRange = utils.decode_range(sheet["!fullref"] || sheet["!ref"]);
    if (fullRange.e.r >= maxSpreadsheetRows + 31 || fullRange.e.c >= 100)
      return {
        name,
        rows: [],
        headerRow: 0,
        error:
          "Foaia depășește 5.000 de rânduri sau 100 de coloane. Împarte datele în foi mai mici; nu am trunchiat importul.",
      };
    const rows = utils
      .sheet_to_json<string[]>(sheet, {
        header: 1,
        raw: false,
        defval: "",
        blankrows: true,
        range: { s: { r: 0, c: 0 }, e: fullRange.e },
      })
      .map((row) => row.map((cell) => String(cell).trim()));
    cells += rows.reduce((sum, row) => sum + row.length, 0);
    if (
      cells > 250000 ||
      rows.some((r) => r.some((cell) => cell.length > 20000))
    )
      throw new Error(
        "Prea mult conținut într-un singur fișier. Împarte datele în fișiere mai mici.",
      );
    const headerRow = detectHeaderRow(rows);
    const result = { name, rows, headerRow };
    if (sheetRecords(result, headerRow).records.length > maxSpreadsheetRows)
      return {
        name,
        rows: [],
        headerRow,
        error: "Foaia are peste 5.000 de prospecte. Împarte-o în foi mai mici.",
      };
    return result;
  });
  if (
    !sheets.some(
      (sheet) => sheet.rows.some((row) => row.some(Boolean)) || sheet.error,
    )
  )
    throw new Error("Fișierul nu conține date de importat.");
  return { sheets };
}
