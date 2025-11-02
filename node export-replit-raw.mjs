import fs from "fs";
import path from "path";
import { Client } from "@replit/object-storage";

const storage = new Client();
const EXPORT_DIR = "bucket_export";

fs.mkdirSync(EXPORT_DIR, { recursive: true });

async function exportRaw() {
  console.log("🔌 Connecting to Replit Object Storage...");
  const { ok, value: objects, error } = await storage.list("public/documents/");

  if (!ok) {
    console.error("❌ Failed to list:", error);
    return;
  }

  console.log(`📄 Found ${objects.length} files.`);

  for (const obj of objects) {
    const key = obj.name || obj.key || obj;

    if (!key.startsWith("documents/") && !key.startsWith("public/documents/")) {
      continue;
    }

    // Normalize key (strip leading public/)
    const cleanKey = key.replace(/^public\//, "");

    const savePath = path.join(EXPORT_DIR, cleanKey);

    // Ensure directories exist
    fs.mkdirSync(path.dirname(savePath), { recursive: true });

    console.log(`⬇️ Downloading: ${cleanKey}`);

    const { ok: dlOk, value: bytes, error: dlErr } = await storage.downloadAsBytes(key);

    if (!dlOk) {
      console.warn(`⚠️ Failed to download ${cleanKey}: ${dlErr?.message || dlErr}`);
      continue;
    }

    fs.writeFileSync(savePath, Buffer.from(bytes));

    console.log(`✅ Saved exactly as: ${savePath}`);
  }

  console.log(`\n🎉 Export complete! Files saved exactly as stored in: ${EXPORT_DIR}/`);
}

exportRaw();
