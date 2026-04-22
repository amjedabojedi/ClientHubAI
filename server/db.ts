import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Create postgres connection pool (postgres.js).
//
// Note: "idle" connections in pg_stat_activity are expected with pooling. These
// settings cap pool size and allow unused sockets to close automatically.
const sql = postgres(process.env.DATABASE_URL!, {
  max:
    parsePositiveInt(process.env.DB_POOL_MAX) ??
    (process.env.NODE_ENV === "production" ? 5 : 2),
  idle_timeout: parsePositiveInt(process.env.DB_IDLE_TIMEOUT_SECONDS) ?? 60,
  max_lifetime: parsePositiveInt(process.env.DB_MAX_LIFETIME_SECONDS) ?? 10 * 60,
  connect_timeout: parsePositiveInt(process.env.DB_CONNECT_TIMEOUT_SECONDS) ?? 10,
});

// Create drizzle instance with postgres driver
export const db = drizzle(sql, { schema });

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
