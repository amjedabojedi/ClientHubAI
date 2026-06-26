/**
 * One-time, idempotent backfill of the per-statement therapist tag.
 *
 * For existing statements that have NO therapist assigned yet, infer it from the
 * sessions their lines were matched to. Because each statement belongs to one
 * therapist, the matched lines should all point at the same therapist — so we
 * only set the tag when it is UNAMBIGUOUS (exactly one distinct therapist across
 * the statement's matched lines). Statements that can't be inferred (nothing
 * matched yet) are left blank for manual assignment.
 *
 * Safe to re-run: only fills statements where therapist_id IS NULL.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  const result: any = await db.execute(sql`
    UPDATE insurance_statements s
    SET therapist_id = sub.therapist_id
    FROM (
      SELECT
        isl.statement_id,
        MIN(sess.therapist_id) AS therapist_id,
        COUNT(DISTINCT sess.therapist_id) AS n
      FROM insurance_statement_lines isl
      JOIN session_billing sb ON isl.matched_session_billing_id = sb.id
      JOIN sessions sess ON sb.session_id = sess.id
      WHERE sess.therapist_id IS NOT NULL
      GROUP BY isl.statement_id
    ) sub
    WHERE s.id = sub.statement_id
      AND s.therapist_id IS NULL
      AND sub.n = 1
  `);

  const count = (result?.rowCount ?? result?.count ?? 0) as number;
  console.log(`backfill-insurance-statement-therapist: assigned therapist to ${count} statement(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("backfill-insurance-statement-therapist failed:", err);
    process.exit(1);
  });
