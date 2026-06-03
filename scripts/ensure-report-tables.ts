/**
 * Idempotently create the report-template feature tables.
 *
 * Background: the AI client-report feature adds two tables — `report_templates`
 * (admin-uploaded Word/PDF templates) and `client_reports` (AI-generated client
 * reports following the draft -> review -> finalize flow). The project rule is to
 * avoid `db:push` because of known practice_configuration drift, so this script
 * applies the DDL additively and idempotently instead. It is safe to run on every
 * deploy / post-merge: `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS`
 * are no-ops when the objects already exist.
 *
 * The column set mirrors the Drizzle definitions in shared/schema.ts
 * (reportTemplates, clientReports). Keep them in sync when the schema changes.
 *
 * Run with: npx tsx scripts/ensure-report-tables.ts
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function main() {
  // ----- report_templates -----
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS report_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      ai_instructions TEXT,
      original_name VARCHAR(500) NOT NULL,
      mime_type VARCHAR(150) NOT NULL,
      file_size INTEGER,
      file_blob_name VARCHAR(1000),
      file_url TEXT,
      structure_text TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Additive columns for tables that may predate the Azure file-reference fields.
  await db.execute(
    sql`ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS file_blob_name VARCHAR(1000)`,
  );
  await db.execute(
    sql`ALTER TABLE report_templates ADD COLUMN IF NOT EXISTS file_url TEXT`,
  );

  // ----- client_reports -----
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS client_reports (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      template_id INTEGER REFERENCES report_templates(id) ON DELETE SET NULL,
      template_name VARCHAR(255),
      generated_content TEXT,
      draft_content TEXT,
      final_content TEXT,
      is_draft BOOLEAN NOT NULL DEFAULT TRUE,
      is_finalized BOOLEAN NOT NULL DEFAULT FALSE,
      generated_at TIMESTAMP,
      edited_at TIMESTAMP,
      finalized_at TIMESTAMP,
      created_by_id INTEGER NOT NULL REFERENCES users(id),
      finalized_by_id INTEGER REFERENCES users(id)
    )
  `);

  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_client_reports_client_id ON client_reports(client_id)`,
  );

  console.log("[report-tables] Ensured report_templates and client_reports tables.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[report-tables] Failed to ensure report tables:", err);
    process.exit(1);
  });
