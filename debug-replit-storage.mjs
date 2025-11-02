import { Client } from "@replit/object-storage";

async function main() {
  console.log("🔌 Connecting to Replit Object Storage...");
  const storage = new Client();

  console.log("📦 Listing all stored objects under: public/documents/");
  const { ok, value, error } = await storage.list("public/documents/");

  if (!ok) {
    console.error("❌ Failed to list:", error);
    return;
  }

  console.log(`\n📄 Found ${value.length} files in public/documents/:\n`);

  for (const obj of value.slice(0, 20)) { // show first 20 files
    console.log(" -", obj.name || obj.key || JSON.stringify(obj));
  }

  console.log("\n✅ Listing complete.\n");
}

main();
