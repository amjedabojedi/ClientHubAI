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

// Normalize an Excel serial date or string date into YYYY-MM-DD (or null).
function toIsoDate(v: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  // Excel stores dates as serial numbers; xlsx can give us a parsed Date.
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
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
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
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

// Parse an Excel/CSV buffer into our structured statement shape. No AI is used
// for spreadsheets — the columns are read directly with heuristic header mapping.
export function parseInsuranceSpreadsheet(buffer: Buffer): ExtractedInsuranceStatement {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) {
    throw new Error("The spreadsheet has no sheets.");
  }
  const sheet = wb.Sheets[firstSheet];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  if (!rows.length) {
    throw new Error("The spreadsheet has no data rows.");
  }

  const headers = Object.keys(rows[0]);
  const colFor: Partial<Record<keyof ExtractedInsuranceLine, string>> = {};
  (Object.keys(HEADER_MAP) as (keyof ExtractedInsuranceLine)[]).forEach((field) => {
    const col = matchHeader(headers, HEADER_MAP[field]);
    if (col) colFor[field] = col;
  });

  // "paid" is ambiguous (could match patient-paid). Prefer a column that
  // explicitly mentions insurance/plan if both "paid" and "patient resp" map to
  // the same column.
  if (colFor.insurancePaidAmount && colFor.insurancePaidAmount === colFor.patientResponsibility) {
    delete colFor.patientResponsibility;
  }

  const lines: ExtractedInsuranceLine[] = rows
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
    // drop completely empty rows
    .filter(
      (l) =>
        l.serviceDate ||
        l.clientName ||
        l.serviceCode ||
        l.billedAmount != null ||
        l.insurancePaidAmount != null,
    );

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
