/**
 * One-time, idempotent backfill of payment-transaction provenance.
 *
 * Insurance payments posted BEFORE the provenance columns existed have
 * source_statement_id / source_statement_line_id = NULL, even though the app
 * stamped the originating statement into the transaction's notes
 * ("Insurance statement #N (Payer)" on post, "Void of insurance statement #N: …"
 * on void). This recovers the link from those notes so historical payments show
 * their source too.
 *
 * Safe to re-run: only fills rows where source_statement_id IS NULL, only sets a
 * statement id that actually exists, and never overwrites an existing link.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  // 1) Statement id — recoverable from the notes of both post and void rows
  //    ("…statement #N…"). Only set when that statement still exists (FK-safe).
  const stmtRes: any = await db.execute(sql`
    UPDATE payment_transactions pt
    SET source_statement_id = (substring(pt.notes from 'statement #([0-9]+)'))::int
    FROM insurance_statements s
    WHERE pt.source_statement_id IS NULL
      AND pt.notes ~ 'statement #[0-9]+'
      AND s.id = (substring(pt.notes from 'statement #([0-9]+)'))::int
  `);

  // 2) Line id — best-effort for the positive "post" rows: the posted line of
  //    that statement on the same billing whose posted amount matches. Skipped
  //    for void/negative rows (no positive postedAmount to match).
  const lineRes: any = await db.execute(sql`
    UPDATE payment_transactions pt
    SET source_statement_line_id = l.id
    FROM insurance_statement_lines l
    WHERE pt.source_statement_line_id IS NULL
      AND pt.source_statement_id IS NOT NULL
      AND l.statement_id = pt.source_statement_id
      AND l.matched_session_billing_id = pt.session_billing_id
      AND l.match_status = 'posted'
      AND l.posted_amount IS NOT NULL
      AND l.posted_amount::numeric = pt.amount::numeric
  `);

  const stmtCount = stmtRes?.rowCount ?? stmtRes?.rows?.length ?? 0;
  const lineCount = lineRes?.rowCount ?? lineRes?.rows?.length ?? 0;
  console.log(
    `backfill-statement-payment-link: linked ${stmtCount} payment(s) to a statement, ${lineCount} of them to a specific line.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-statement-payment-link failed:", err);
    process.exit(1);
  });
