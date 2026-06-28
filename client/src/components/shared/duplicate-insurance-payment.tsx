import { useMemo } from "react";
import {
  DUPLICATE_INSURANCE_TOLERANCE_PCT,
  DUPLICATE_INSURANCE_MIN_TOLERANCE,
  isDuplicateInsuranceAmount,
} from "@shared/insurance";

// Advisory duplicate-insurance-payment safeguard shared between the Billing
// Dashboard PaymentDialog and the client profile "Record Payment" mini-form.
//
// Insurance payments already posted from an uploaded statement (an EOB) are
// tracked on each billing record's transactions. Keying a manual insurance
// amount that closely matches one of those usually means someone is re-entering
// money the statement already recorded, which would double-count collected
// insurance. The tolerance is intentionally tight (within ~5% / $1) so genuine
// top-up payments of a different amount are NOT flagged.
//
// The tolerance itself lives in @shared/insurance so the server-side block in
// storage.recordPayment uses the exact same rule and the two can never drift.

// Re-exported for existing importers that pull these from this module.
export { DUPLICATE_INSURANCE_TOLERANCE_PCT, DUPLICATE_INSURANCE_MIN_TOLERANCE };

export interface PostedStatementInsuranceTxn {
  amount: number | string;
  sourceStatementId?: number | string | null;
  statementPayerName?: string | null;
  statementCheckNumber?: string | null;
  [key: string]: any;
}

interface UseDuplicateInsurancePaymentArgs {
  transactions: any[] | undefined;
  amount: number;
  // Whether the amount being entered is an insurance payment at all. The Billing
  // Dashboard has a dedicated insurance section (always insurance); the mini-form
  // only treats it as insurance when the chosen method is "insurance".
  isInsurancePayment: boolean;
}

interface UseDuplicateInsurancePaymentResult {
  postedStatementInsuranceTxns: PostedStatementInsuranceTxn[];
  duplicateStatementMatch: PostedStatementInsuranceTxn | null;
}

export function useDuplicateInsurancePayment({
  transactions,
  amount,
  isInsurancePayment,
}: UseDuplicateInsurancePaymentArgs): UseDuplicateInsurancePaymentResult {
  const postedStatementInsuranceTxns = useMemo(
    () =>
      (transactions || []).filter(
        (t: any) =>
          !t.voidedAt &&
          t.source === "insurance" &&
          t.sourceStatementId &&
          Math.abs(Number(t.amount) || 0) > 0,
      ),
    [transactions],
  );

  const duplicateStatementMatch = useMemo(() => {
    if (!isInsurancePayment) return null;
    if (!(amount > 0)) return null;
    for (const t of postedStatementInsuranceTxns) {
      const amt = Math.abs(Number(t.amount) || 0);
      if (isDuplicateInsuranceAmount(amount, amt)) return t;
    }
    return null;
  }, [postedStatementInsuranceTxns, amount, isInsurancePayment]);

  return { postedStatementInsuranceTxns, duplicateStatementMatch };
}

interface DuplicateInsuranceWarningProps {
  match: PostedStatementInsuranceTxn | null;
  confirmed: boolean;
  onConfirmedChange: (checked: boolean) => void;
  // When the amount matches a posted statement payment but the staffer has the
  // payment method set to something OTHER than insurance, surface an extra note
  // that the matching money is insurance and (if it's not a duplicate) should be
  // recorded with the Insurance method. Keeps the wrong-method path from
  // silently double-counting.
  methodMismatch?: boolean;
}

export function DuplicateInsuranceWarning({
  match,
  confirmed,
  onConfirmedChange,
  methodMismatch = false,
}: DuplicateInsuranceWarningProps) {
  if (!match) return null;
  return (
    <div
      className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800"
      data-testid="duplicate-statement-warning"
    >
      <input
        type="checkbox"
        id="confirmDuplicateInsurance"
        checked={confirmed}
        onChange={(e) => onConfirmedChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer"
        data-testid="confirm-duplicate-insurance-checkbox"
      />
      <label
        htmlFor="confirmDuplicateInsurance"
        className="text-xs text-amber-900 dark:text-amber-200 cursor-pointer leading-relaxed"
      >
        <span className="font-semibold">
          Looks like a duplicate of an already-posted statement payment.
        </span>{" "}
        ${Math.abs(Number(match.amount) || 0).toFixed(2)} was already recorded for this session from
        insurance statement #{match.sourceStatementId}
        {match.statementPayerName ? ` (${match.statementPayerName})` : ""}
        {match.statementCheckNumber ? ` · check ${match.statementCheckNumber}` : ""}.
        Keying it again here will double-count the insurance collected.
        {methodMismatch ? (
          <>
            {" "}
            <span
              className="font-semibold"
              data-testid="duplicate-statement-method-note"
            >
              This is insurance money — if it's a genuine new payment, record it with the
              Insurance method.
            </span>
          </>
        ) : null}
        {" "}Check this box only if this is a separate, additional payment.
      </label>
    </div>
  );
}
