import { db } from '../server/db';
import { clients, users } from '../shared/schema';
import { eq, isNull, isNotNull, and } from 'drizzle-orm';
import { normalizePhoneE164 } from '@shared/phone';

/**
 * Backfill the standardized SMS copy (`phoneE164`) for existing rows.
 *
 * Non-destructive: the typed `phone` is never touched. We only fill `phoneE164`
 * where it is currently empty and the typed number can be standardized. Numbers
 * that can't be standardized are left null and summarized at the end so they can
 * be reviewed/corrected manually.
 *
 * Idempotent: rows that already have a `phoneE164` are skipped, so re-running is
 * safe. Run with: npx tsx scripts/backfill-phone-e164.ts
 */
async function backfillTable(
  label: string,
  rows: { id: number; phone: string | null }[],
  update: (id: number, value: string) => Promise<void>,
) {
  let filled = 0;
  let unconvertible = 0;
  for (const row of rows) {
    const normalized = normalizePhoneE164(row.phone);
    if (normalized) {
      await update(row.id, normalized);
      filled++;
    } else if (row.phone && row.phone.trim()) {
      unconvertible++;
      console.log(`  [${label}] id=${row.id} phone="${row.phone}" could not be standardized`);
    }
  }
  console.log(`[${label}] filled ${filled}, unconvertible ${unconvertible}, total considered ${rows.length}`);
}

async function main() {
  console.log('Backfilling phoneE164 for clients and users...');

  const clientRows = await db
    .select({ id: clients.id, phone: clients.phone })
    .from(clients)
    .where(and(isNull(clients.phoneE164), isNotNull(clients.phone)));
  await backfillTable('clients', clientRows, async (id, value) => {
    await db.update(clients).set({ phoneE164: value }).where(eq(clients.id, id));
  });

  const userRows = await db
    .select({ id: users.id, phone: users.phone })
    .from(users)
    .where(and(isNull(users.phoneE164), isNotNull(users.phone)));
  await backfillTable('users', userRows, async (id, value) => {
    await db.update(users).set({ phoneE164: value }).where(eq(users.id, id));
  });

  console.log('Backfill complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
