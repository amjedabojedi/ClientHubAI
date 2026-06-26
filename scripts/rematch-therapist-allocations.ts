/**
 * One-time maintenance: re-match a therapist's LUMP-payment allocations to their
 * earned sessions in correct chronological order (oldest session first, oldest
 * payment first).
 *
 * WHY: lump payouts entered out of payment-date order grabbed sessions by
 * creation order instead of by date, so a payment could end up "covering"
 * sessions that occurred months after it was made. That makes each payout's
 * session breakdown disagree with the chronological Statement, even though every
 * payment AMOUNT and the overall net balance are correct.
 *
 * SCOPE / SAFETY:
 *  - Only LUMP payouts are touched. If the therapist has any paid *itemized*
 *    payouts (whose coverage lives in therapist_payout_items, not allocations),
 *    the script aborts — rewriting allocations there would double-count paid
 *    money against payout_items.
 *  - Rewrites ONLY therapist_payment_allocations rows and each lump payout's
 *    unapplied_amount. Never changes a payout's total, payment date, reference,
 *    status, or the therapist's net owed/credit.
 *  - Earnings are sourced from the app's *current* rules (computeTherapistEarnings),
 *    NOT the previous allocation snapshots. This is deliberate: the reason a
 *    rematch is needed is that the old snapshots held wrong (e.g. doubled)
 *    amounts that were since corrected; the corrected ledger/statement use
 *    current rules, so the rematched allocations must too, or the mismatch
 *    returns.
 *  - All reads happen INSIDE the write transaction AFTER taking the same
 *    per-therapist advisory lock the app's payout path uses, so a concurrent
 *    payout can't make the plan stale between compute and write.
 *
 * Usage:
 *   tsx scripts/rematch-therapist-allocations.ts <therapistId>            # dry-run
 *   tsx scripts/rematch-therapist-allocations.ts <therapistId> --apply    # write
 */
import 'dotenv/config';
import { db } from '../server/db';
import { storage } from '../server/storage';
import { therapistPayouts, therapistPaymentAllocations, auditLogs } from '@shared/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

const SYSTEM_USER_ID = 6;
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => `$${n.toFixed(2)}`;
const dstr = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

type Payable = {
  billingId: number;
  sessionId: number;
  serviceId: number | null;
  collectedAmount: number;
  payType: string;
  payValue: number;
  amountEarned: number;
  clientName: string;
  sessionDate: Date | string;
  remaining: number;
};

type PlanAlloc = {
  payoutId: number;
  sessionBillingId: number;
  sessionId: number;
  serviceId: number | null;
  basisAmount: number;
  payType: string;
  payValue: number;
  amountEarned: number;
  amountAllocated: number;
  clientName: string;
  sessionDate: Date | string;
};

// Load the inputs (earned-but-payable sessions oldest-first, and paid LUMP
// payouts oldest-payment-first). Pure reads; the caller decides locking.
async function loadInputs(therapistId: number) {
  const earnings: any[] = await (storage as any).computeTherapistEarnings(therapistId);
  const payable: Payable[] = earnings
    .filter((e) => e.payType != null && e.hasRule && e.amountEarned > 0)
    .sort((a, b) => {
      const ta = new Date(a.sessionDate).getTime();
      const tb = new Date(b.sessionDate).getTime();
      if (ta !== tb) return ta - tb;
      return a.billingId - b.billingId;
    })
    .map((e) => ({
      billingId: e.billingId,
      sessionId: e.sessionId,
      serviceId: e.serviceId,
      collectedAmount: e.collectedAmount,
      payType: e.payType,
      payValue: e.payValue ?? 0,
      amountEarned: e.amountEarned,
      clientName: e.clientName,
      sessionDate: e.sessionDate,
      remaining: round2(e.amountEarned),
    }));

  const payouts = await db
    .select()
    .from(therapistPayouts)
    .where(
      and(
        eq(therapistPayouts.therapistId, therapistId),
        eq(therapistPayouts.status, 'paid'),
        eq(therapistPayouts.paymentType, 'lump'),
      ),
    );
  payouts.sort((a, b) => {
    const ta = new Date(a.paymentDate as any).getTime();
    const tb = new Date(b.paymentDate as any).getTime();
    if (ta !== tb) return ta - tb;
    return a.id - b.id;
  });

  return { payable, payouts };
}

// A compact, comparable fingerprint of the inputs, so we can detect any drift
// between the dry-run/plan compute and the locked write.
function fingerprint(payable: Payable[], payouts: { id: number; totalAmount: any }[]) {
  const e = payable.map((p) => `${p.billingId}:${round2(p.amountEarned)}`).join(',');
  const p = payouts.map((o) => `${o.id}:${round2(Number(o.totalAmount))}`).join(',');
  return `E[${e}]P[${p}]`;
}

function buildPlan(payable: Payable[], payouts: { id: number; totalAmount: any }[]) {
  // Fresh remaining counters (don't mutate caller's objects).
  const rem = new Map<number, number>(payable.map((s) => [s.billingId, round2(s.amountEarned)]));
  const newAllocs: PlanAlloc[] = [];
  const unappliedByPayout = new Map<number, number>();

  for (const p of payouts) {
    let payoutRemaining = round2(Number(p.totalAmount));
    for (const s of payable) {
      if (payoutRemaining <= 0) break;
      const left = rem.get(s.billingId) ?? 0;
      if (left <= 0) continue;
      const applyAmt = round2(Math.min(left, payoutRemaining));
      if (applyAmt <= 0) continue;
      newAllocs.push({
        payoutId: p.id,
        sessionBillingId: s.billingId,
        sessionId: s.sessionId,
        serviceId: s.serviceId,
        basisAmount: s.collectedAmount,
        payType: s.payType,
        payValue: s.payValue,
        amountEarned: s.amountEarned,
        amountAllocated: applyAmt,
        clientName: s.clientName,
        sessionDate: s.sessionDate,
      });
      rem.set(s.billingId, round2(left - applyAmt));
      payoutRemaining = round2(payoutRemaining - applyAmt);
    }
    unappliedByPayout.set(p.id, round2(payoutRemaining));
  }

  // Invariants.
  const errors: string[] = [];
  for (const p of payouts) {
    const allocSum = round2(
      newAllocs.filter((a) => a.payoutId === p.id).reduce((s, a) => s + a.amountAllocated, 0),
    );
    const unapplied = unappliedByPayout.get(p.id) ?? 0;
    if (round2(allocSum + unapplied) !== round2(Number(p.totalAmount))) {
      errors.push(`payout ${p.id}: alloc ${allocSum} + unapplied ${unapplied} != total ${p.totalAmount}`);
    }
  }
  for (const s of payable) {
    const perSession = round2(
      newAllocs.filter((a) => a.sessionBillingId === s.billingId).reduce((sum, a) => sum + a.amountAllocated, 0),
    );
    if (perSession > round2(s.amountEarned) + 0.001) {
      errors.push(`session billing ${s.billingId}: allocated ${perSession} > earned ${s.amountEarned}`);
    }
  }
  const totalEarnedPayable = round2(payable.reduce((s, e) => s + e.amountEarned, 0));
  const totalPaid = round2(payouts.reduce((s, p) => s + Number(p.totalAmount), 0));
  const totalAllocated = round2(newAllocs.reduce((s, a) => s + a.amountAllocated, 0));
  const totalUnapplied = round2([...unappliedByPayout.values()].reduce((s, v) => s + v, 0));
  if (round2(totalAllocated + totalUnapplied) !== totalPaid) {
    errors.push(`total allocated ${totalAllocated} + unapplied ${totalUnapplied} != total paid ${totalPaid}`);
  }

  return { newAllocs, unappliedByPayout, totalEarnedPayable, totalPaid, totalAllocated, totalUnapplied, errors };
}

async function main() {
  const therapistId = Number(process.argv[2] || '0');
  const apply = process.argv.includes('--apply');
  if (!therapistId) {
    throw new Error('Usage: tsx scripts/rematch-therapist-allocations.ts <therapistId> [--apply]');
  }

  // Guard: refuse to run if the therapist has any paid *itemized* payouts, whose
  // coverage lives in therapist_payout_items (not allocations). Rewriting
  // allocations alongside those would double-count paid money.
  const nonLump = await db
    .select({ id: therapistPayouts.id })
    .from(therapistPayouts)
    .where(
      and(
        eq(therapistPayouts.therapistId, therapistId),
        eq(therapistPayouts.status, 'paid'),
        sql`${therapistPayouts.paymentType} <> 'lump'`,
      ),
    );
  if (nonLump.length > 0) {
    console.error(
      `ABORT — therapist ${therapistId} has ${nonLump.length} paid non-lump (itemized) payout(s). ` +
        `This rematch only supports lump payouts; itemized coverage lives in payout_items.`,
    );
    process.exit(1);
  }

  const { payable, payouts } = await loadInputs(therapistId);
  if (payouts.length === 0) {
    console.log(`No paid lump payouts for therapist ${therapistId}; nothing to do.`);
    process.exit(0);
  }
  const plan = buildPlan(payable, payouts);
  const { newAllocs, unappliedByPayout, totalEarnedPayable, totalPaid, totalAllocated, totalUnapplied, errors } = plan;

  // Report.
  console.log(`\n=== Re-match plan for therapist ${therapistId} (lump payouts only) ===`);
  console.log(`Total earned (payable): ${fmt(totalEarnedPayable)}`);
  console.log(`Total paid:             ${fmt(totalPaid)}`);
  console.log(`Net (paid - earned):    ${fmt(round2(totalPaid - totalEarnedPayable))} ${totalPaid >= totalEarnedPayable ? '(credit)' : '(owed)'}`);
  console.log(`Total to allocate:      ${fmt(totalAllocated)}`);
  console.log(`Total unapplied credit: ${fmt(totalUnapplied)}\n`);
  for (const p of payouts) {
    const rows = newAllocs.filter((a) => a.payoutId === p.id);
    const dates = rows.map((r) => dstr(r.sessionDate)).sort();
    const range = rows.length ? `${dates[0]} … ${dates[dates.length - 1]}` : '(none)';
    console.log(`Payout #${p.id}  ${dstr(p.paymentDate as any)}  ${fmt(Number(p.totalAmount))}  ${p.referenceNumber || '(no ref)'}`);
    console.log(`   ${rows.length} session(s)  covers ${range}  unapplied ${fmt(unappliedByPayout.get(p.id) ?? 0)}`);
    for (const r of rows) {
      console.log(`     ${dstr(r.sessionDate)}  ${r.clientName.padEnd(34)} earned ${fmt(r.amountEarned).padStart(9)}  paid ${fmt(r.amountAllocated).padStart(9)}`);
    }
  }

  if (errors.length) {
    console.error(`\nABORT — ${errors.length} invariant error(s):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`\nAll invariants OK.`);

  if (!apply) {
    console.log(`\nDRY RUN — no changes written. Re-run with --apply to commit.`);
    process.exit(0);
  }

  const expectedFp = fingerprint(payable, payouts);
  const payoutIds = payouts.map((p) => p.id);

  await db.transaction(async (tx) => {
    // Take the same per-therapist lock the app's payout path uses, THEN re-read
    // and confirm the inputs haven't drifted since we built the plan above.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('therapist_payout'), ${therapistId})`);
    const fresh = await loadInputs(therapistId);
    if (fingerprint(fresh.payable, fresh.payouts) !== expectedFp) {
      throw new Error('Inputs changed since the plan was computed; aborting. Re-run the dry-run and try again.');
    }

    await tx.delete(therapistPaymentAllocations).where(inArray(therapistPaymentAllocations.payoutId, payoutIds));
    for (const a of newAllocs) {
      await tx.insert(therapistPaymentAllocations).values({
        payoutId: a.payoutId,
        sessionBillingId: a.sessionBillingId,
        sessionId: a.sessionId,
        serviceId: a.serviceId,
        basisAmount: String(a.basisAmount),
        payType: a.payType,
        payValue: String(a.payValue),
        amountEarned: String(a.amountEarned),
        amountAllocated: String(a.amountAllocated),
      });
    }
    for (const p of payouts) {
      await tx
        .update(therapistPayouts)
        .set({ unappliedAmount: String(unappliedByPayout.get(p.id) ?? 0) })
        .where(eq(therapistPayouts.id, p.id));
    }
    await tx.insert(auditLogs).values({
      userId: SYSTEM_USER_ID,
      action: 'therapist_payment_allocated',
      result: 'success',
      resourceType: 'therapist',
      resourceId: String(therapistId),
      details: `Re-matched lump-payment allocations to sessions in chronological order. ${newAllocs.length} allocations across ${payouts.length} lump payouts. Totals unchanged: paid ${fmt(totalPaid)}, allocated ${fmt(totalAllocated)}, unapplied credit ${fmt(totalUnapplied)}.`,
    } as any);
  });

  console.log(`\nAPPLIED — ${newAllocs.length} allocations written across ${payouts.length} lump payouts.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
