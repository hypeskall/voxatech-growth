import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  parseSpreadsheet,
  sheetRecords,
  mappedLead,
  guessMapping,
  detectHeaderRow,
  maxSpreadsheetBytes,
} from "../src/lib/lead-spreadsheet.ts";

const grid = [
  ["Export clinici · octombrie"],
  [],
  [
    "Denumire firmă",
    "Oraș",
    "E-mail",
    "Site web",
    "Telefon",
    "Evaluare Google",
    "Număr recenzii",
  ],
  [
    "Clinica Exemplu",
    "Brașov",
    "OFFICE@example.test; second@example.test",
    "www.example.test",
    "0722123456",
    "4,8",
    "1.234",
  ],
];

test("recognizes Romanian clinic workbook headers without confusing email source columns", () => {
  const headers = [
    "Clinică / cabinet",
    "Email",
    "Localitate",
    "Județ",
    "Telefon",
    "Stare sursă email",
    "Contact nominal",
    "Website",
    "Adresă",
    "Data listei-sursă",
    "Sursa contactului",
    "Sursa emailului",
    "Consultat la",
    "Status campanie",
    "Emailuri suplimentare",
    "Tip adresă",
  ];
  const mapping = guessMapping(headers);
  assert.equal(mapping.company_name, "Clinică / cabinet");
  assert.equal(mapping.contact_name, "Contact nominal");
  assert.equal(mapping.email, "Email");
  assert.equal(mapping.notes, "Adresă");
  const row = [
    "Cabinet Exemplu",
    "office@example.test",
    "Iași",
    "Iași",
    "0722123456",
    "Publicat 2026",
    "Dr. Exemplu",
    "",
    "Strada Exemplu 1",
  ];
  const { records } = sheetRecords(
    { name: "Leads", rows: [headers, row], headerRow: 0 },
    0,
  );
  const lead = mappedLead(records[0], mapping, "clinici.xlsx");
  assert.equal(lead.company_name, "Cabinet Exemplu");
  assert.equal(lead.contact_name, "Dr. Exemplu");
  assert.equal(lead.website, null);
});
function workbook(type, rows = grid) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Note"], ["Export de test"]]),
    "Instrucțiuni",
  );
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Clinici");
  if (type === "xltx" || type === "xltm") {
    const bytes = XLSX.write(book, {
      type: "buffer",
      bookType: type === "xltx" ? "xlsx" : "xlsm",
    });
    const zip = XLSX.CFB.read(bytes, { type: "buffer" });
    const entry = XLSX.CFB.find(zip, "/[Content_Types].xml");
    const xml = Buffer.from(entry.content).toString("utf8");
    entry.content = Buffer.from(
      xml.replace(
        type === "xltx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
          : "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
        type === "xltx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml"
          : "application/vnd.ms-excel.template.macroEnabled.main+xml",
      ),
    );
    entry.size = entry.content.length;
    return Uint8Array.from(
      XLSX.CFB.write(zip, { type: "buffer", fileType: "zip" }),
    ).buffer;
  }
  return XLSX.write(book, { type: "array", bookType: type });
}
for (const [extension, bookType] of [
  ["xlsx", "xlsx"],
  ["xls", "biff8"],
  ["xlsm", "xlsm"],
  ["xlsb", "xlsb"],
  ["xltx", "xltx"],
  ["xltm", "xltm"],
  ["xlt", "biff8"],
  ["xml", "xlml"],
  ["ods", "ods"],
]) {
  test(`extracts leads from .${extension}, skips title rows, preserves phone zero and Romanian text`, async () => {
    const data = await parseSpreadsheet(
      workbook(bookType),
      `leads.${extension}`,
    );
    const sheet = data.sheets.find((s) => s.name === "Clinici");
    assert.equal(sheet.headerRow, 2);
    const { headers, records } = sheetRecords(sheet, sheet.headerRow);
    assert.equal(records.length, 1);
    assert.equal(records[0].row, 4);
    const lead = mappedLead(
      records[0],
      guessMapping(headers),
      `leads.${extension}`,
    );
    assert.equal(lead.company_name, "Clinica Exemplu");
    assert.equal(lead.city, "Brașov");
    assert.equal(lead.email, "office@example.test");
    assert.equal(lead.website, "https://www.example.test");
    assert.equal(lead.phone, "0722123456");
    assert.equal(lead.google_rating, "4.8");
    assert.equal(lead.review_count, "1234");
  });
}
test("CSV with BOM and semicolon and TSV preserve diacritics", async () => {
  for (const [filename, delimiter] of [
    ["leads.csv", ";"],
    ["leads.tsv", "\t"],
  ]) {
    const bytes = new TextEncoder().encode(
      "\ufeffCompanie" +
        delimiter +
        "Email\nClinica Iași" +
        delimiter +
        "office@example.test\n",
    ).buffer;
    const sheet = (await parseSpreadsheet(bytes, filename)).sheets[0];
    const result = sheetRecords(sheet, sheet.headerRow);
    assert.equal(result.records[0].values.Companie, "Clinica Iași");
    assert.equal(result.records.length, 1);
  }
});
test("duplicate and missing headers stay distinct, blank rows and repeated headers are skipped", () => {
  const sheet = {
    name: "Test",
    headerRow: 0,
    rows: [
      ["Company", "Email", "Email", ""],
      [],
      ["A", "a@example.test", "b@example.test", "notes"],
      ["Company", "Email", "Email", ""],
    ],
  };
  const { headers, records } = sheetRecords(sheet, 0);
  assert.deepEqual(headers, ["Company", "Email", "Email (2)", "Coloana 4"]);
  assert.equal(records.length, 1);
  assert.equal(records[0].row, 3);
  assert.equal(guessMapping(headers).company_name, "Company");
  assert.equal(guessMapping(headers).email, "Email");
  assert.equal(sheetRecords(sheet, -1).records.length, 3);
  assert.equal(detectHeaderRow(grid), 2);
});
test("does not silently import truncated, oversized or empty workbooks", async () => {
  const rows = [
    ["Company", "Email"],
    ...Array.from({ length: 5100 }, (_, i) => [
      `Lead ${i}`,
      `lead${i}@example.test`,
    ]),
  ];
  const data = await parseSpreadsheet(workbook("xlsx", rows), "big.xlsx");
  assert.match(data.sheets[1].error, /depășește/);
  assert.equal(data.sheets[1].rows.length, 0);
  await assert.rejects(
    parseSpreadsheet(new ArrayBuffer(maxSpreadsheetBytes + 1), "big.xlsx"),
    /10 MB/,
  );
  await assert.rejects(
    parseSpreadsheet(new ArrayBuffer(0), "empty.xlsx"),
    /10 MB/,
  );
  await assert.rejects(
    parseSpreadsheet(new ArrayBuffer(4), "wrong.exe"),
    /Alege/,
  );
});
test("reads cached formula values without evaluating formulas", async () => {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Company", "Email"],
    ["Clinica", "office@example.test"],
  ]);
  sheet.A2 = {
    t: "s",
    v: "Clinica",
    f: 'HYPERLINK("https://example.test", "Clinica")',
  };
  XLSX.utils.book_append_sheet(book, sheet, "Leads");
  const data = await parseSpreadsheet(
    XLSX.write(book, { type: "array", bookType: "xlsx" }),
    "leads.xlsx",
  );
  assert.equal(data.sheets[0].rows[1][0], "Clinica");
});
