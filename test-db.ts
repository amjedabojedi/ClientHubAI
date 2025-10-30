// test-db.ts
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    const result = await sql`SELECT NOW();`;
    console.log("✅ Connected successfully:", result[0]);
  } catch (err) {
    console.error("❌ Database connection failed:", err);
  } finally {
    await sql.end();
  }
})();
