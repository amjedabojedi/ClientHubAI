/**
 * One-off correction approved by the owner:
 *
 * Statement #989 legitimately paid $160.00 for each of five Donald Sallows
 * Psy06 sessions. Their billing records had an outdated $149.61 rate and 30%
 * discount, making the displayed net bill $104.73 despite the correct payment.
 *
 * This preserves the statement-backed payment transactions, makes each billing
 * amount agree with the $160.00 payment, records an auditable billing update,
 * and re-syncs the affected therapist's append-only earnings ledger.
 *
 * Safe to re-run: it only changes the exact pre-correction values or validates
 * the already-corrected values before proceeding.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../server/db";
import {
  auditLogs,
  clients,
  paymentTransactions,
  sessionBilling,
  sessions,
} from "../shared/schema";
import { storage } from "../server/storage";

const SYSTEM_USER_ID = 6;
const THERAPIST_ID = 14;
const BILLING_IDS = [2447, 2540, 2594, 2681, 2761] as const;
const EXPECTED_PAYMENT = 160;
const OLD_RATE = 149.61;
const OLD_DISCOUNT = 44.88;
const STATEMENT_ID = 989;
const REASON =
  "Owner confirmed statement #989 correctly paid $160.00 for this MVA session; " +
  "updated the service rate and removed the outdated 30% discount so the bill matches the insurer payment.";

function money(value: unknown): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

async function main() {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        billingId: sessionBilling.id,
        sessionId: sessionBilling.sessionId,
        ratePerUnit: sessionBilling.ratePerUnit,
        totalAmount: sessionBilling.totalAmount,
        discountAmount: sessionBilling.discountAmount,
        insurancePaidAmount: sessionBilling.insurancePaidAmount,
        clientPaidAmount: sessionBilling.clientPaidAmount,
        paymentAmount: sessionBilling.paymentAmount,
        paymentStatus: sessionBilling.paymentStatus,
        therapistId: sessions.therapistId,
        clientId: clients.id,
        clientName: clients.fullName,
      })
      .from(sessionBilling)
      .innerJoin(sessions, eq(sessionBilling.sessionId, sessions.id))
      .innerJoin(clients, eq(sessions.clientId, clients.id))
      .where(inArray(sessionBilling.id, [...BILLING_IDS]));

    if (rows.length !== BILLING_IDS.length) {
      throw new Error(`Expected ${BILLING_IDS.length} billing rows; found ${rows.length}.`);
    }

    const activeStatementPayments = await tx
      .select({
        billingId: paymentTransactions.sessionBillingId,
        amount: paymentTransactions.amount,
        source: paymentTransactions.source,
        sourceStatementId: paymentTransactions.sourceStatementId,
        voidedAt: paymentTransactions.voidedAt,
      })
      .from(paymentTransactions)
      .where(
        and(
          inArray(paymentTransactions.sessionBillingId, [...BILLING_IDS]),
          eq(paymentTransactions.sourceStatementId, STATEMENT_ID),
        ),
      );

    const paymentByBilling = new Map<number, typeof activeStatementPayments>();
    for (const payment of activeStatementPayments) {
      const billingId = Number(payment.billingId);
      const existing = paymentByBilling.get(billingId) ?? [];
      existing.push(payment);
      paymentByBilling.set(billingId, existing);
    }

    for (const row of rows) {
      const billingId = Number(row.billingId);
      if (Number(row.therapistId) !== THERAPIST_ID || !/^Donald Sallows\s*$/i.test(row.clientName)) {
        throw new Error(`Billing ${billingId} is not the expected Donald Sallows session.`);
      }

      const payments = paymentByBilling.get(billingId) ?? [];
      if (
        payments.length !== 1 ||
        payments[0].voidedAt ||
        payments[0].source !== "insurance" ||
        money(payments[0].amount) !== EXPECTED_PAYMENT
      ) {
        throw new Error(`Billing ${billingId} does not have exactly one active $160.00 insurance payment from statement #989.`);
      }

      const alreadyCorrected =
        money(row.ratePerUnit) === EXPECTED_PAYMENT &&
        money(row.totalAmount) === EXPECTED_PAYMENT &&
        row.discountAmount == null &&
        money(row.insurancePaidAmount) === EXPECTED_PAYMENT &&
        money(row.clientPaidAmount) === 0 &&
        money(row.paymentAmount) === EXPECTED_PAYMENT &&
        row.paymentStatus === "paid";

      const needsCorrection =
        money(row.ratePerUnit) === OLD_RATE &&
        money(row.totalAmount) === OLD_RATE &&
        money(row.discountAmount) === OLD_DISCOUNT &&
        money(row.insurancePaidAmount) === EXPECTED_PAYMENT &&
        money(row.clientPaidAmount) === 0 &&
        money(row.paymentAmount) === EXPECTED_PAYMENT &&
        row.paymentStatus === "paid";

      if (!alreadyCorrected && !needsCorrection) {
        throw new Error(`Billing ${billingId} changed unexpectedly; no correction was applied.`);
      }
    }

    const needingUpdate = rows.filter((row) => money(row.totalAmount) !== EXPECTED_PAYMENT);
    if (needingUpdate.length === 0) {
      console.log("All five billings were already corrected; no billing rows changed.");
      return;
    }

    const correctedAt = new Date();
    await tx
      .update(sessionBilling)
      .set({
        ratePerUnit: EXPECTED_PAYMENT.toFixed(2),
        totalAmount: EXPECTED_PAYMENT.toFixed(2),
        discountType: null,
        discountValue: null,
        discountAmount: null,
        updatedAt: correctedAt,
      })
      .where(inArray(sessionBilling.id, needingUpdate.map((row) => Number(row.billingId))));

    await tx.insert(auditLogs).values(
      needingUpdate.map((row) => ({
        userId: SYSTEM_USER_ID,
        username: "system",
        action: "billing_updated" as const,
        result: "success" as const,
        resourceType: "session_billing",
        resourceId: String(row.billingId),
        clientId: Number(row.clientId),
        details: JSON.stringify({
          reason: REASON,
          statementId: STATEMENT_ID,
          previous: {
            ratePerUnit: money(row.ratePerUnit),
            totalAmount: money(row.totalAmount),
            discountAmount: money(row.discountAmount),
            netBill: money(row.totalAmount) - money(row.discountAmount),
          },
          corrected: {
            ratePerUnit: EXPECTED_PAYMENT,
            totalAmount: EXPECTED_PAYMENT,
            discountAmount: 0,
            netBill: EXPECTED_PAYMENT,
            insurancePaidAmount: EXPECTED_PAYMENT,
          },
        }),
        hipaaRelevant: true,
      })),
    );

    console.log(`Corrected ${needingUpdate.length} billing records.`);
  });

  const syncResult = await (storage as any).syncTherapistEarnings(THERAPIST_ID);
  console.log(`Re-synced therapist ${THERAPIST_ID}; unresolved=${syncResult?.unresolvedCount ?? 0}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});