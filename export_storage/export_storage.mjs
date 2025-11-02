import fs from "fs";
import path from "path";
import { Client } from "@replit/object-storage";

const storage = new Client();
const OUTPUT_BASE = "./storage-export/"; // download into current workspace

async function exportRaw() {
  console.log("🔌 Connecting…");

  const { ok, value: objects, error } = await storage.list("public/documents/");
  if (!ok) {
    console.error("❌ list failed:", error);
    return;
  }

  console.log(`📄 Found ${objects.length} objects\n`);

  for (const obj of objects) {
    const key = obj.name || obj.key;
    if (!key) continue;

    console.log(`⬇️ Downloading: ${key}`);

    const { ok: dlOK, value: base64Data, error: dlErr } =
      await storage.downloadAsText(key);

    if (!dlOK) {
      console.log(`⚠️ Failed ${key}:`, dlErr);
      continue;
    }

    const buffer = Buffer.from(base64Data, "base64");

    // Resolve full save path
    const savePath = path.join(OUTPUT_BASE, key);

    // ✅ Create directory if missing
    fs.mkdirSync(path.dirname(savePath), { recursive: true });

    fs.writeFileSync(savePath, buffer);

    console.log(`✅ Saved: ${savePath}`);
  }

  console.log("\n🎉 Finished exporting all raw files.");
}

exportRaw();
