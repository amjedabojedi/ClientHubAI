/**
 * READ-ONLY audit: find bills whose saved "amount paid" has drifted from the
 * payment history.
 *
 * Each session_billing row stores its collected totals in two authoritative
 * columns — client_paid_amount and insurance_paid_amount — which the
 * record/void/reverse paths keep equal to the running sum of that bill's
 * non-voided payment_transactions (per source). Legacy data or past manual
 * corrections can leave these out of sync. This script lists every billing
 * record where a stored column differs from the sum of its non-voided
 * transactions by more than $0.01, so the drift can be reviewed and corrected.
 *
 * It performs NO writes and is safe to run against production.
 *
 *   npx tsx scripts/audit-paid-amount-drift.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

const TOLERANCE = 0.01;

async function main() {
  // Aggregate non-voided transactions per (billing, source), compare against the
  // stored columns, and join through to the owning client for identification.
  // payment_transactions.amount is a signed delta (reversals are negative), so
  // summing the non-voided rows reproduces the authoritative stored total.
  const rows = await db.execute(sql`
    WITH txn_sums AS (
      SELECT
        session_billing_id,
        COALESCE(SUM(CASE WHEN source = 'client'    THEN amount::numeric ELSE 0 END), 0) AS client_txn_total,
        COALESCE(SUM(CASE WHEN source = 'insurance' THEN amount::numeric ELSE 0 END), 0) AS insurance_txn_total
      FROM payment_transactions
      WHERE voided_at IS NULL
      GROUP BY session_billing_id
    )
    SELECT
      sb.id                                              AS billing_id,
      c.id                                               AS client_pk,
      c.client_id                                        AS client_code,
      c.full_name                                        AS client_name,
      sb.session_id                                      AS session_id,
      sb.billing_date                                    AS billing_date,
      sb.payment_status                                  AS payment_status,
      COALESCE(sb.client_paid_amount, '0')::numeric      AS stored_client_paid,
      COALESCE(ts.client_txn_total, 0)                   AS txn_client_paid,
      COALESCE(sb.insurance_paid_amount, '0')::numeric   AS stored_insurance_paid,
      COALESCE(ts.insurance_txn_total, 0)                AS txn_insurance_paid
    FROM session_billing sb
    LEFT JOIN txn_sums ts ON ts.session_billing_id = sb.id
    INNER JOIN sessions s ON s.id = sb.session_id
    INNER JOIN clients  c ON c.id = s.client_id
    WHERE
      ABS(COALESCE(sb.client_paid_amount, '0')::numeric    - COALESCE(ts.client_txn_total, 0))    > ${TOLERANCE}
      OR
      ABS(COALESCE(sb.insurance_paid_amount, '0')::numeric - COALESCE(ts.insurance_txn_total, 0)) > ${TOLERANCE}
    ORDER BY c.full_name, sb.id
  `);

  const data: any[] = (rows as any).rows || (rows as any) || [];

  if (data.length === 0) {
    console.log("✓ No drift found. Every bill's stored paid columns match its non-voided payment history (within $0.01).");
    process.exit(0);
  }

  const fmt = (n: any) => Number(n).toFixed(2);

  console.log(`⚠ Found ${data.length} billing record(s) where the stored "amount paid" drifts from the payment history (> $${TOLERANCE.toFixed(2)}):\n`);

  for (const r of data) {
    const clientDrift = Number(r.stored_client_paid) - Number(r.txn_client_paid);
    const insuranceDrift = Number(r.stored_insurance_paid) - Number(r.txn_insurance_paid);

    console.log(`Billing #${r.billing_id}  (session #${r.session_id}, status=${r.payment_status}, billed=${r.billing_date ?? "n/a"})`);
    console.log(`  Client: ${r.client_name} [${r.client_code}] (id ${r.client_pk})`);
    if (Math.abs(clientDrift) > TOLERANCE) {
      console.log(`  CLIENT    paid — stored $${fmt(r.stored_client_paid)}  vs  payments $${fmt(r.txn_client_paid)}  (drift ${clientDrift >= 0 ? "+" : ""}$${fmt(clientDrift)})`);
    }
    if (Math.abs(insuranceDrift) > TOLERANCE) {
      console.log(`  INSURANCE paid — stored $${fmt(r.stored_insurance_paid)}  vs  payments $${fmt(r.txn_insurance_paid)}  (drift ${insuranceDrift >= 0 ? "+" : ""}$${fmt(insuranceDrift)})`);
    }
    console.log("");
  }

  console.log(`Summary: ${data.length} drifted billing record(s). This was a read-only audit — no data was changed.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(1);
});
