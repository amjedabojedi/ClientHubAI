import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Create postgres connection
const sql = postgres(process.env.DATABASE_URL!);

// Create drizzle instance with postgres driver
export const db = drizzle(sql, { schema });