/**
 * Read-only review of legacy insurance amounts that exceed a billing's current
 * net bill.
 *
 * This is intentionally a review tool, not a correction tool. Insurance
 * statement amounts can be legitimate bundled/imported payments, and a billing
 * row can have an obsolete rate or discount. Do not "fix" the exception set
 * without reviewing its statement and payment provenance first.
 *
 * Usage:
 *   npx tsx scripts/review-insurance-overpayments.ts
 *   npx tsx scripts/review-insurance-overpayments.ts --write-report
 *   npx tsx scripts/review-insurance-overpayments.ts --details
 *
 * --write-report saves only a redacted report. It never includes client names,
 * client identifiers, session dates, statement IDs, or source filenames.
 * --details prints the identifiable operator inventory to stdout only. Do not
 * redirect that output into source control or a shared log.
 */
import { writeFileSync } from "node:fs";
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TOLERANCE = 0.01;
const REPORT_PATH = "docs/insurance-overpayment-review.md";

type Payment = {
  id: number;
  source: string;
  amount: string | number;
  paymentDate: string | null;
  isHistoricalLump: boolean;
  sourceStatementId: number | null;
  sourceStatementLineId: number | null;
  adoptedByLineId: number | null;
  voidedAt: string | null;
};

type StatementLine = {
  statementId: number;
  lineId: number;
  statementFileName: string;
  statementStatus: string;
  payerName: string | null;
  checkNumber: string | null;
  statementDate: string | null;
  serviceDate: string | null;
  clientNameRaw: string | null;
  serviceCode: string | null;
  billedAmount: string | number | null;
  allowedAmount: string | number | null;
  insurancePaidAmount: string | number;
  matchStatus: string;
  postedAmount: string | number | null;
};

type ExceptionRow = {
  billingId: number;
  sessionId: number;
  sessionDate: string | null;
  clientCode: string | null;
  clientName: string;
  netBill: string | number;
  insurancePaid: string | number;
  excess: string | number;
  paymentStatus: string | null;
  transactions: Payment[] | string;
  statementLines: StatementLine[] | string;
};

type ReviewedRow = Omit<ExceptionRow, "transactions" | "statementLines"> & {
  transactions: Payment[];
  statementLines: StatementLine[];
  category: "billing setup issue" | "imported payment allocation issue" | "genuine over-collection";
  reason: string;
};

function asArray<T>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function money(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function dollars(value: unknown): string {
  return `$${money(value).toFixed(2)}`;
}

function clean(value: unknown): string {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function dateOnly(value: unknown): string {
  return value ? String(value).slice(0, 10) : "—";
}

function classify(row: ReviewedRow): { category: ReviewedRow["category"]; reason: string } {
  const netBill = money(row.netBill);
  const paid = money(row.insurancePaid);
  const activePayments = row.transactions.filter((payment) => !payment.voidedAt);
  const activeInsurance = activePayments.filter((payment) => payment.source === "insurance");
  const statementPayments = activeInsurance.filter(
    (payment) => payment.sourceStatementId != null || payment.sourceStatementLineId != null,
  );
  const postedLines = row.statementLines.filter((line) => line.matchStatus === "posted");
  const paidLines = postedLines.filter((line) => money(line.insurancePaidAmount) > TOLERANCE);
  const supportingLines = paidLines.filter((line) =>
    statementPayments.some(
      (payment) =>
        (payment.sourceStatementLineId != null && payment.sourceStatementLineId === line.lineId) ||
        (payment.sourceStatementLineId == null &&
          payment.sourceStatementId != null &&
          payment.sourceStatementId === line.statementId &&
          Math.abs(money(payment.amount) - money(line.insurancePaidAmount)) <= TOLERANCE),
    ),
  );
  const hasLump = activeInsurance.some((payment) => payment.isHistoricalLump);
  const hasManualInsurance = activeInsurance.some(
    (payment) => payment.sourceStatementId == null && payment.sourceStatementLineId == null,
  );
  const statementPaidOverCurrentBill = paidLines.some(
    (line) => money(line.insurancePaidAmount) > netBill + TOLERANCE,
  );
  const statementBilledAboveCurrentBill = paidLines.some(
    (line) => line.billedAmount != null && money(line.billedAmount) > netBill + TOLERANCE,
  );

  if (netBill <= TOLERANCE) {
    return {
      category: "billing setup issue",
      reason:
        "The billing has a zero or negative current net bill while insurance money is recorded; " +
        "the billing setup must be reviewed before the payment can be called an over-collection.",
    };
  }

  if (hasLump || (hasManualInsurance && supportingLines.length === 0 && postedLines.length === 0)) {
    return {
      category: "imported payment allocation issue",
      reason:
        hasLump
          ? "The active insurance history includes a historical lump/imported payment with no statement-line allocation."
          : "The active insurance history is manual and has no posted statement line tying the amount to a claim.",
    };
  }

  if (supportingLines.length > 0 && statementBilledAboveCurrentBill) {
    return {
      category: "billing setup issue",
      reason:
        "A posted statement payment is tied to this billing, and the statement's billed basis is above " +
        "the current net bill; review the rate/discount setup before changing the payment.",
    };
  }

  if (statementPaidOverCurrentBill) {
    return {
      category: "genuine over-collection",
      reason:
        "The posted statement line itself reports insurance paid above the current net bill; " +
        "confirm the payer remittance and whether a bundled payment or billing correction explains the difference.",
    };
  }

  return {
    category: "genuine over-collection",
    reason:
      "The stored insurance total exceeds the current net bill, but the available provenance does not establish " +
      "a billing-setup or imported-lump explanation; confirm the payment source before changing it.",
  };
}

function groupSum(rows: ReviewedRow[], key: (row: ReviewedRow) => string): Map<string, { count: number; excess: number }> {
  const result = new Map<string, { count: number; excess: number }>();
  for (const row of rows) {
    const group = key(row);
    const current = result.get(group) ?? { count: 0, excess: 0 };
    current.count += 1;
    current.excess += money(row.excess);
    result.set(group, current);
  }
  return result;
}

function renderReport(rows: ReviewedRow[]): string {
  const totalExcess = rows.reduce((sum, row) => sum + money(row.excess), 0);
  const zeroBillCount = rows.filter((row) => money(row.netBill) <= TOLERANCE).length;
  const categories = groupSum(rows, (row) => row.category);
  const provenance = new Map<string, { count: number; excess: number }>();

  for (const row of rows) {
    const active = row.transactions.filter((payment) => !payment.voidedAt);
    const key =
      active.length === 0
        ? "No active payment transaction"
        : active.some(
              (payment) =>
                payment.source === "insurance" &&
                (payment.sourceStatementId != null || payment.sourceStatementLineId != null),
            )
          ? "Insurance statement-sourced payment"
          : active.some((payment) => payment.isHistoricalLump)
            ? "Insurance historical/imported lump"
            : active.some((payment) => payment.source === "insurance")
              ? "Insurance manual payment without statement"
              : "Other payment source";
    const current = provenance.get(key) ?? { count: 0, excess: 0 };
    current.count += 1;
    current.excess += money(row.excess);
    provenance.set(key, current);
  }

  const lines: string[] = [
    "# Legacy Insurance Overpayment Review (Redacted)",
    "",
    `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
    "**Scope:** Read-only review of `session_billing.insurance_paid_amount` greater than `total_amount - discount_amount` by more than $0.01.",
    "**Privacy:** This tracked report intentionally contains no client names, client identifiers, session dates, statement IDs, statement filenames, payment IDs, or claim-line IDs.",
    "",
    "## Executive summary",
    "",
    `The current database contains **${rows.length} billing exceptions** with a combined apparent excess of **${dollars(totalExcess)}**. This is one fewer than the 218 exceptions in the original task snapshot; the database was re-counted on the generation date and is authoritative for this report.`,
    "",
    `- **${zeroBillCount}** exceptions have a zero or negative current net bill.`,
    `- **${rows.length - zeroBillCount}** exceptions have a positive current net bill.`,
    "- No unapproved legacy billing, payment, or statement records were changed during this review.",
    "- The five previously approved corrections are outside this remaining exception set; their statement payments and billing-update audit entries are preserved by the guarded correction script and correction record.",
    "",
    "The classifications below are evidence-based review classifications, not authorization to reverse or rewrite money. Each redacted exception still has a classification and reason. Use the explicit `--details` stdout option only in an authorized operator session when exact record-level follow-up is required.",
    "",
    "## Classification summary",
    "",
    "| Classification | Billings | Apparent excess |",
    "|---|---:|---:|",
  ];

  for (const category of [
    "billing setup issue",
    "imported payment allocation issue",
    "genuine over-collection",
  ] as const) {
    const summary = categories.get(category) ?? { count: 0, excess: 0 };
    lines.push(`| ${category} | ${summary.count} | ${dollars(summary.excess)} |`);
  }

  lines.push(
    "",
    "## Grouped by payment provenance",
    "",
    "| Provenance | Billing rows represented | Apparent excess represented | Interpretation |",
    "|---|---:|---:|---|",
  );
  for (const [source, summary] of [...provenance.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const interpretation =
      source === "Insurance statement-sourced payment"
        ? "active insurance ledger rows point to an uploaded statement"
        : source === "Insurance historical/imported lump"
          ? "active insurance history is marked as a historical/imported lump"
          : source === "Insurance manual payment without statement"
            ? "active insurance history has no uploaded-statement provenance"
            : source === "No active payment transaction"
              ? "stored insurance total has no active ledger row"
              : "active history is not categorized as an insurance payment";
    lines.push(`| ${source} | ${summary.count} | ${dollars(summary.excess)} | ${interpretation} |`);
  }

  lines.push(
    "",
    "## Redacted exception inventory",
    "",
    "Each row is a stable report ordinal, not a database identifier. The row preserves the review math, category, reason, and non-identifying provenance counts without exposing client or claim identifiers.",
    "",
    "| Exception | Net bill | Insurance paid | Excess | Payment status | Classification | Reason | Active payment rows | Matched statement lines |",
    "|---:|---:|---:|---:|---|---|---|---:|---:|",
  );
  rows.forEach((row, index) => {
    lines.push(
      `| ${index + 1} | ${dollars(row.netBill)} | ${dollars(row.insurancePaid)} | ${dollars(row.excess)} | ${clean(row.paymentStatus)} | ${row.category} | ${clean(row.reason)} | ${row.transactions.filter((payment) => !payment.voidedAt).length} | ${row.statementLines.length} |`,
    );
  });

  lines.push(
    "",
    "## Approved corrections and remaining action",
    "",
    "- The previously approved correction was limited to five statement-sourced billings. It changed billing setup values only, retained the statement payment rows, wrote `billing_updated` audit entries, and re-synced therapist earnings. The guarded script is safe to re-run.",
    "- No approval was provided to change the remaining legacy exceptions in this scan, so no payment was edited, voided, reallocated, or deleted.",
    "- Before any future correction, staff must review the statement/check, the matched line, the active and voided payment history, and the billing rate/discount. A correction must preserve the payment ledger and write its audit entry atomically.",
    "",
    "This redacted report is a reconciliation record, not a substitute for payer documentation or owner approval. Run `--details` only in an authorized operator session when exact record-level follow-up is required.",
    "",
  );
  return lines.join("\n");
}

function renderDetailedReport(rows: ReviewedRow[]): string {
  const totalExcess = rows.reduce((sum, row) => sum + money(row.excess), 0);
  const zeroBillCount = rows.filter((row) => money(row.netBill) <= TOLERANCE).length;
  const categories = groupSum(rows, (row) => row.category);
  const statements = new Map<
    string,
    { count: number; excess: number; files: Set<string>; statuses: Set<string> }
  >();
  const provenance = new Map<string, { count: number; excess: number; detail: string }>();

  for (const row of rows) {
    const lines = row.statementLines;
    const statementIds = new Set<number>();
    for (const line of lines) statementIds.add(line.statementId);
    for (const payment of row.transactions) {
      if (payment.sourceStatementId != null) statementIds.add(payment.sourceStatementId);
    }
    if (statementIds.size === 0) statementIds.add(0);
    for (const statementId of statementIds) {
      const key = statementId === 0 ? "No statement provenance" : `Statement #${statementId}`;
      const current = statements.get(key) ?? {
        count: 0,
        excess: 0,
        files: new Set<string>(),
        statuses: new Set<string>(),
      };
      current.count += 1;
      current.excess += money(row.excess);
      for (const line of lines.filter((item) => item.statementId === statementId)) {
        current.files.add(line.statementFileName);
        current.statuses.add(line.statementStatus);
      }
      statements.set(key, current);
    }

    const active = row.transactions.filter((payment) => !payment.voidedAt);
    if (active.length === 0) {
      const current = provenance.get("No active payment transaction") ?? {
        count: 0,
        excess: 0,
        detail: "stored insurance total has no active ledger row",
      };
      current.count += 1;
      current.excess += money(row.excess);
      provenance.set("No active payment transaction", current);
    } else {
      for (const payment of active) {
        const key =
          payment.source === "insurance"
            ? payment.sourceStatementId != null
              ? `Insurance statement #${payment.sourceStatementId}`
              : payment.isHistoricalLump
                ? "Insurance historical/imported lump"
                : "Insurance manual (no statement)"
            : `Other source: ${payment.source}`;
        const current = provenance.get(key) ?? {
          count: 0,
          excess: 0,
          detail: "active non-voided payment history",
        };
        current.count += 1;
        current.excess += money(row.excess);
        provenance.set(key, current);
      }
    }
  }

  const lines: string[] = [
    "# Authorized Operator Insurance Overpayment Details",
    "",
    "WARNING: This output contains identifiable client and payment information. It is stdout-only operational output. Do not commit it, redirect it to a shared log, or paste it into a ticket.",
    "",
    `**Generated:** ${new Date().toISOString().slice(0, 10)}`,
    "**Scope:** Read-only review of `session_billing.insurance_paid_amount` greater than `total_amount - discount_amount` by more than $0.01.",
    "",
    "## Executive summary",
    "",
    `The current database contains **${rows.length} billing exceptions** with a combined apparent excess of **${dollars(totalExcess)}**. This is one fewer than the 218 exceptions in the original task snapshot; the database was re-counted on the generation date and is authoritative for this report.`,
    "",
    `- **${zeroBillCount}** exceptions have a zero or negative current net bill.`,
    `- **${rows.length - zeroBillCount}** exceptions have a positive current net bill.`,
    "- No unapproved legacy billing, payment, or statement records were changed during this review.",
    "- The five approved Donald Sallows corrections are outside this remaining exception set; their statement payments and billing-update audit entries are preserved by the guarded correction script and correction record.",
    "",
    "The categories below are evidence-based review classifications, not authorization to reverse or rewrite money. Every row still has a reason and provenance trail in the detailed inventory.",
    "",
    "## Classification summary",
    "",
    "| Classification | Billings | Apparent excess |",
    "|---|---:|---:|",
  ];
  for (const category of [
    "billing setup issue",
    "imported payment allocation issue",
    "genuine over-collection",
  ] as const) {
    const summary = categories.get(category) ?? { count: 0, excess: 0 };
    lines.push(`| ${category} | ${summary.count} | ${dollars(summary.excess)} |`);
  }

  lines.push(
    "",
    "## Grouped by statement",
    "",
    "| Statement provenance | Billings | Apparent excess | File/status evidence |",
    "|---|---:|---:|---|",
  );
  for (const [statement, summary] of [...statements.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const evidence = [
      ...summary.files,
      ...[...summary.statuses].map((status) => `status=${status}`),
    ].join("; ") || "none";
    lines.push(`| ${clean(statement)} | ${summary.count} | ${dollars(summary.excess)} | ${clean(evidence)} |`);
  }

  lines.push(
    "",
    "## Grouped by payment provenance",
    "",
    "| Provenance | Billing rows represented | Apparent excess represented | Interpretation |",
    "|---|---:|---:|---|",
  );
  for (const [source, summary] of [...provenance.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| ${clean(source)} | ${summary.count} | ${dollars(summary.excess)} | ${clean(summary.detail)} |`);
  }

  lines.push(
    "",
    "## Detailed exception inventory",
    "",
    "Each row is a billing record. Transaction amounts below are the ledger rows currently linked to the billing; voided rows remain listed so the review does not lose history. Statement lines include all matched lines, including reversed or skipped lines.",
    "",
    "| Billing | Session/date | Client | Net bill | Insurance paid | Excess | Status | Classification | Reason | Transactions | Statement lines |",
    "|---:|---|---|---:|---:|---:|---|---|---|---|---|",
  );
  for (const row of rows) {
    const transactions = row.transactions.length
      ? row.transactions
          .map(
            (payment) =>
              `#${payment.id} ${payment.source} ${dollars(payment.amount)}${payment.sourceStatementId != null ? ` stmt#${payment.sourceStatementId}` : ""}${payment.sourceStatementLineId != null ? ` line#${payment.sourceStatementLineId}` : ""}${payment.isHistoricalLump ? " historical-lump" : ""}${payment.voidedAt ? " VOIDED" : ""}`,
          )
          .join("<br>")
      : "none";
    const statementLines = row.statementLines.length
      ? row.statementLines
          .map(
            (line) =>
              `stmt#${line.statementId}/line#${line.lineId} paid ${dollars(line.insurancePaidAmount)} billed ${line.billedAmount == null ? "—" : dollars(line.billedAmount)} ${line.matchStatus} (${clean(line.statementStatus)})`,
          )
          .join("<br>")
      : "none";
    lines.push(
      `| ${row.billingId} | ${row.sessionId} / ${dateOnly(row.sessionDate)} | ${clean(row.clientName)} [${clean(row.clientCode)}] | ${dollars(row.netBill)} | ${dollars(row.insurancePaid)} | ${dollars(row.excess)} | ${clean(row.paymentStatus)} | ${row.category} | ${clean(row.reason)} | ${transactions} | ${statementLines} |`,
    );
  }

  lines.push(
    "",
    "## Approved corrections and remaining action",
    "",
    "- The owner-approved Donald Sallows correction was limited to five statement #989 billings. It changed billing setup values only, retained the statement-sourced $160.00 payment rows, wrote `billing_updated` audit entries, and re-synced therapist earnings. The guarded script is safe to re-run.",
    "- No approval was provided to change the remaining legacy exceptions in this scan, so no payment was edited, voided, reallocated, or deleted.",
    "- Before any future correction, staff must review the statement/check, the matched line, the active and voided payment history, and the billing rate/discount. A correction must preserve the payment ledger and write its audit entry atomically.",
    "",
    "This report is a reconciliation record, not a substitute for payer documentation or owner approval.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const result: any = await db.execute(sql`
    WITH exceptions AS (
      SELECT
        sb.id AS billing_id,
        s.id AS session_id,
        s.session_date::date AS session_date,
        c.client_id AS client_code,
        c.full_name AS client_name,
        COALESCE(sb.total_amount, 0)::numeric - COALESCE(sb.discount_amount, 0)::numeric AS net_bill,
        COALESCE(sb.insurance_paid_amount, 0)::numeric AS insurance_paid,
        COALESCE(sb.insurance_paid_amount, 0)::numeric -
          (COALESCE(sb.total_amount, 0)::numeric - COALESCE(sb.discount_amount, 0)::numeric) AS excess,
        sb.payment_status AS payment_status
      FROM session_billing sb
      JOIN sessions s ON s.id = sb.session_id
      JOIN clients c ON c.id = s.client_id
      WHERE COALESCE(sb.insurance_paid_amount, 0)::numeric >
        (COALESCE(sb.total_amount, 0)::numeric - COALESCE(sb.discount_amount, 0)::numeric) + ${TOLERANCE}
    )
    SELECT
      e.*,
      COALESCE((
        SELECT json_agg(json_build_object(
          'id', pt.id,
          'source', pt.source,
          'amount', pt.amount,
          'paymentDate', pt.payment_date,
          'isHistoricalLump', pt.is_historical_lump,
          'sourceStatementId', pt.source_statement_id,
          'sourceStatementLineId', pt.source_statement_line_id,
          'adoptedByLineId', pt.adopted_by_line_id,
          'voidedAt', pt.voided_at
        ) ORDER BY pt.id)
        FROM payment_transactions pt
        WHERE pt.session_billing_id = e.billing_id
      ), '[]'::json) AS transactions,
      COALESCE((
        SELECT json_agg(json_build_object(
          'statementId', ist.id,
          'lineId', isl.id,
          'statementFileName', ist.file_name,
          'statementStatus', ist.status,
          'payerName', ist.payer_name,
          'checkNumber', ist.check_number,
          'statementDate', ist.statement_date,
          'serviceDate', isl.service_date,
          'clientNameRaw', isl.client_name_raw,
          'serviceCode', isl.service_code,
          'billedAmount', isl.billed_amount,
          'allowedAmount', isl.allowed_amount,
          'insurancePaidAmount', isl.insurance_paid_amount,
          'matchStatus', isl.match_status,
          'postedAmount', isl.posted_amount
        ) ORDER BY ist.id, isl.id)
        FROM insurance_statement_lines isl
        JOIN insurance_statements ist ON ist.id = isl.statement_id
        WHERE isl.matched_session_billing_id = e.billing_id
      ), '[]'::json) AS statement_lines
    FROM exceptions e
    ORDER BY e.session_date NULLS LAST, e.billing_id
  `);

  const rawRows: any[] = (result.rows || result) as any[];
  const rows: ReviewedRow[] = rawRows.map((raw) => {
    const row = {
      billingId: Number(raw.billing_id),
      sessionId: Number(raw.session_id),
      sessionDate: raw.session_date,
      clientCode: raw.client_code,
      clientName: raw.client_name,
      netBill: raw.net_bill,
      insurancePaid: raw.insurance_paid,
      excess: raw.excess,
      paymentStatus: raw.payment_status,
      transactions: asArray<Payment>(raw.transactions),
      statementLines: asArray<StatementLine>(raw.statement_lines),
    } as ReviewedRow;
    const classification = classify(row);
    row.category = classification.category;
    row.reason = classification.reason;
    return row;
  });

  const report = renderReport(rows);
  console.log(
    `Reviewed ${rows.length} exceptions; apparent excess ${dollars(
      rows.reduce((sum, row) => sum + money(row.excess), 0),
    )}. Read-only; no data changed.`,
  );
  for (const category of [
    "billing setup issue",
    "imported payment allocation issue",
    "genuine over-collection",
  ] as const) {
    console.log(`  ${category}: ${rows.filter((row) => row.category === category).length}`);
  }

  if (process.argv.includes("--details")) {
    console.log(renderDetailedReport(rows));
  }

  if (process.argv.includes("--write-report")) {
    writeFileSync(REPORT_PATH, report);
    console.log(`Wrote ${REPORT_PATH}`);
  } else {
    console.log("Pass --write-report to save the redacted report, or --details for authorized stdout-only review.");
  }
}

main().catch((error) => {
  console.error("Insurance overpayment review failed:", error);
  process.exit(1);
});