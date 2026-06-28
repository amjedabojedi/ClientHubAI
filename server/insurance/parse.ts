import * as XLSX from "xlsx";
import { extractDocumentText } from "../report-templates/extract";
import {
  extractInsuranceStatementFromText,
  type ExtractedInsuranceStatement,
  type ExtractedInsuranceLine,
} from "../ai/openai";

export type InsuranceSourceType = "pdf" | "excel";

export interface ParsedInsuranceUpload {
  sourceType: InsuranceSourceType;
  extracted: ExtractedInsuranceStatement;
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Format a Date using its LOCAL calendar parts (never UTC), so a date-only value
// can't shift a day in a non-UTC timezone. xlsx builds Date cells in local time,
// so local getters recover the date the cell actually represents.
function fmtLocalDate(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Normalize an Excel serial date or string date into YYYY-MM-DD (or null).
function toIsoDate(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  // Excel stores dates as serial numbers; xlsx can give us a parsed Date.
  if (v instanceof Date && !isNaN(v.getTime())) {
    return fmtLocalDate(v);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const parsed = XLSX.SSF?.parse_date_code?.(v);
    if (parsed && parsed.y) {
      const mm = String(parsed.m).padStart(2, "0");
      const dd = String(parsed.d).padStart(2, "0");
      return `${parsed.y}-${mm}-${dd}`;
    }
  }
  const s = String(v).trim();
  // already ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // M/D/YYYY or MM/DD/YYYY
  const us = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (us) {
    let [, m, d, y] = us;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return fmtLocalDate(dt);
  return null;
}

// Heuristic header matching: lowercase a header and test if it contains any of
// the given needles. Used to map a spreadsheet's arbitrary column names onto our
// canonical fields without forcing the user into a fixed template.
function matchHeader(headers: string[], needles: string[]): string | null {
  for (const h of headers) {
    const lh = h.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const n of needles) {
      if (lh.includes(n)) return h;
    }
  }
  return null;
}

const HEADER_MAP: Record<keyof ExtractedInsuranceLine, string[]> = {
  serviceDate: ["servicedate", "dateofservice", "dos", "svcdate", "date"],
  clientName: ["patient", "client", "member", "insured", "name"],
  serviceCode: ["cpt", "procedure", "proccode", "servicecode", "code"],
  billedAmount: ["billed", "charge", "charged", "submitted"],
  allowedAmount: ["allowed", "approved"],
  insurancePaidAmount: ["paid", "payment", "insurancepaid", "planpaid", "benefit"],
  patientResponsibility: ["patientresp", "patientresponsibility", "copay", "coinsurance", "deductible", "responsibility"],
  remarkCode: ["remark", "adjustment", "denial", "reason", "carc", "remarkcode"],
};

// Identifier-style columns (e.g. "Payment ID", "Claim Number", "Account #",
// "Auth No", "Reference") hold long numbers that are NOT money. They routinely
// collide with money needles ("Payment ID" matches "payment", "Charge No"
// matches "charge"), so a misread turns a 10-digit id into a giant dollar amount
// and the row overflows the money columns. We exclude these headers when mapping
// the money fields. Matching is token-based (split on non-alphanumerics) so we
// never trip on substrings like the "id" inside "paid". "claim"/"account" are
// deliberately NOT treated as identifiers on their own, because legitimate money
// headers like "Claim Paid" / "Account Balance" exist — only the id/number/ref
// suffix (or a literal #) marks a column as an identifier.
function isIdentifierHeader(h: string): boolean {
  if (h.includes("#")) return true;
  const tokens = h.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const idTokens = new Set(["id", "number", "no", "num", "ref", "reference", "acct"]);
  return tokens.some((t) => idTokens.has(t));
}

const MONEY_FIELDS: ReadonlySet<keyof ExtractedInsuranceLine> = new Set<keyof ExtractedInsuranceLine>([
  "billedAmount",
  "allowedAmount",
  "insurancePaidAmount",
  "patientResponsibility",
]);

// Map a set of header strings onto our canonical fields, including the
// invoice-summary fallback for the paid amount. Shared by table scoring (below)
// and the final parse so both agree on what a header row resolves to.
function buildColumnMap(headers: string[]): Partial<Record<keyof ExtractedInsuranceLine, string>> {
  const colFor: Partial<Record<keyof ExtractedInsuranceLine, string>> = {};
  // Money fields may only map to non-identifier columns.
  const moneyHeaders = headers.filter((h) => !isIdentifierHeader(h));
  (Object.keys(HEADER_MAP) as (keyof ExtractedInsuranceLine)[]).forEach((field) => {
    const pool = MONEY_FIELDS.has(field) ? moneyHeaders : headers;
    const col = matchHeader(pool, HEADER_MAP[field]);
    if (col) colFor[field] = col;
  });

  // "paid" is ambiguous (could match patient-paid). Prefer a column that
  // explicitly mentions insurance/plan if both "paid" and "patient resp" map to
  // the same column.
  if (colFor.insurancePaidAmount && colFor.insurancePaidAmount === colFor.patientResponsibility) {
    delete colFor.patientResponsibility;
  }

  // Invoice / billing summaries (not insurer EOBs) often have no explicit "paid"
  // column — the amount sits in a column like "Total Due", "Amount", or "Total".
  // When no paid column matched, fall back to one of these as the paid amount,
  // but only consider columns NOT already claimed by another field, so we never
  // mistake "Billed Amount", "Allowed", or "Patient Responsibility" for payment.
  if (!colFor.insurancePaidAmount) {
    const claimed = new Set(Object.values(colFor));
    // Most specific needles first so "Total Due"/"Total Paid" beats a bare "Total".
    const fallbackNeedles = [
      "totaldue",
      "amountdue",
      "balancedue",
      "totalpaid",
      "totalpayment",
      "amount",
      "total",
      "due",
    ];
    outer: for (const n of fallbackNeedles) {
      for (const h of headers) {
        if (claimed.has(h)) continue;
        if (isIdentifierHeader(h)) continue; // never read an id/number column as money
        const lh = h.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (lh.includes("date")) continue; // never read a date column as money
        if (lh.includes(n)) {
          colFor.insurancePaidAmount = h;
          break outer;
        }
      }
    }
  }

  return colFor;
}

// Decide whether a sheet row is the column-header row (titles), as opposed to a
// title banner, a totals line, or a data row. Exported reports routinely put a
// title/summary banner above the real headers, so we can't assume it's row 1.
function looksLikeHeaderRow(cells: any[]): boolean {
  const cellHas = (needles: string[]) =>
    cells.some((c) => {
      const lh = String(c ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return lh !== "" && needles.some((n) => lh.includes(n));
    });
  const hasClient = cellHas(HEADER_MAP.clientName);
  const hasDate = cellHas(HEADER_MAP.serviceDate);
  const hasAmount = cellHas([
    ...HEADER_MAP.insurancePaidAmount,
    ...HEADER_MAP.billedAmount,
    ...HEADER_MAP.allowedAmount,
    "totaldue",
    "amountdue",
    "balancedue",
    "amount",
    "total",
    "due",
  ]);
  // A real header row names who (client) plus when-or-how-much (date or amount).
  return hasClient && (hasDate || hasAmount);
}

// Locate the best data table in a workbook. Exported reports can have title
// banners above the header, totals rows below it, and multiple sheets (e.g. a
// "Summary" tab before the detail tab). We collect every header-like row across
// all sheets and pick the strongest: prefer a table that has BOTH a client and a
// service-date column, then the one mapping the most known columns, then the
// earliest sheet/row. This keeps a summary/aggregate tab from beating the detail.
function locateTable(wb: XLSX.WorkBook): { headers: string[]; dataRows: Record<string, any>[] } {
  type Candidate = {
    headers: string[];
    dataRows: Record<string, any>[];
    fieldCount: number;
    hasDate: boolean;
    sheetIdx: number;
    headerIdx: number;
  };
  const candidates: Candidate[] = [];

  wb.SheetNames.forEach((sheetName, sheetIdx) => {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return;
    const aoa: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    aoa.forEach((row, headerIdx) => {
      if (!Array.isArray(row) || !looksLikeHeaderRow(row)) return;
      const headers = row.map((h, i) => {
        const s = h == null ? "" : String(h).trim();
        return s || `__col${i}`;
      });
      const colFor = buildColumnMap(headers);
      const dataRows = aoa.slice(headerIdx + 1).map((r) => {
        const obj: Record<string, any> = {};
        headers.forEach((h, i) => {
          obj[h] = r?.[i] ?? null;
        });
        return obj;
      });
      candidates.push({
        headers,
        dataRows,
        fieldCount: Object.keys(colFor).length,
        hasDate: !!colFor.serviceDate,
        sheetIdx,
        headerIdx,
      });
    });
  });

  if (!candidates.length) {
    throw new Error(
      "Couldn't find a column header row in this spreadsheet. Make sure it has columns like Client (or Patient), Service Date, and an amount such as Total Due or Paid.",
    );
  }

  // Strongest first: date-bearing tables, then most mapped columns, then earliest.
  candidates.sort(
    (a, b) =>
      Number(b.hasDate) - Number(a.hasDate) ||
      b.fieldCount - a.fieldCount ||
      a.sheetIdx - b.sheetIdx ||
      a.headerIdx - b.headerIdx,
  );
  const best = candidates[0];
  return { headers: best.headers, dataRows: best.dataRows };
}

// Parse an Excel/CSV buffer into our structured statement shape. No AI is used
// for spreadsheets — the columns are read directly with heuristic header mapping.
export function parseInsuranceSpreadsheet(buffer: Buffer): ExtractedInsuranceStatement {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  if (!wb.SheetNames.length) {
    throw new Error("The spreadsheet has no sheets.");
  }
  const { headers, dataRows } = locateTable(wb);
  const colFor = buildColumnMap(headers);

  const lines: ExtractedInsuranceLine[] = dataRows
    .map((r) => {
      const get = (f: keyof ExtractedInsuranceLine) => (colFor[f] ? r[colFor[f]!] : null);
      const line: ExtractedInsuranceLine = {
        serviceDate: toIsoDate(get("serviceDate")),
        clientName: get("clientName") != null ? String(get("clientName")).trim() || null : null,
        serviceCode: get("serviceCode") != null && get("serviceCode") !== "" ? String(get("serviceCode")).trim() : null,
        billedAmount: numOrNull(get("billedAmount")),
        allowedAmount: numOrNull(get("allowedAmount")),
        insurancePaidAmount: numOrNull(get("insurancePaidAmount")),
        patientResponsibility: numOrNull(get("patientResponsibility")),
        remarkCode: get("remarkCode") != null && get("remarkCode") !== "" ? String(get("remarkCode")).trim() : null,
      };
      return line;
    })
    // Keep only rows that name a client. A line with no client can never match a
    // session, and this drops totals/variance/banner rows (e.g. "Grand Total")
    // that have an amount but no client name.
    .filter((l) => !!l.clientName);

  const totalPaid = lines.reduce((sum, l) => sum + (l.insurancePaidAmount ?? 0), 0);
  return {
    payerName: null,
    checkNumber: null,
    statementDate: null,
    totalPaid: lines.length ? Number(totalPaid.toFixed(2)) : null,
    lines,
  };
}

// Top-level dispatcher: decide whether the upload is a PDF/document (AI read) or
// a spreadsheet (direct parse) and return the structured statement.
export async function parseInsuranceUpload(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<ParsedInsuranceUpload> {
  const name = (originalName || "").toLowerCase();
  const isSpreadsheet =
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".csv") ||
    mimeType === "text/csv" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  if (isSpreadsheet) {
    return { sourceType: "excel", extracted: parseInsuranceSpreadsheet(buffer) };
  }

  // PDF / docx / txt → extract text then AI structure it.
  const text = await extractDocumentText(buffer, mimeType, originalName);
  const extracted = await extractInsuranceStatementFromText(text);
  return { sourceType: "pdf", extracted };
}
