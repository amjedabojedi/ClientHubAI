#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { Client } from "@replit/object-storage";

async function exportAll() {
  const client = new Client(); // auto-detect bucket
  console.log("📦 Listing stored items...");

  const { ok, value, error } = await client.list();
  if (!ok) {
    console.error("❌ Failed to list objects:", error);
    process.exit(1);
  }

  const objects = value; // <-- this is an ARRAY of StorageObject
  console.log(`📄 Found ${objects.length} stored objects.`);

  fs.mkdirSync("bucket_export", { recursive: true });

  for (const obj of objects) {
    const key = obj.key;

    // Determine filename
    const metadataName = obj.metadata?.fileName || obj.metadata?.originalName;
    const fallbackName = `${key}.bin`;
    const finalName = metadataName ? `${key}-${metadataName}` : fallbackName;

    const exportPath = path.join("bucket_export", finalName);

    console.log(`⬇️ Downloading: ${finalName}`);

    const { ok: downloaded, value: bytes, error: downloadErr } =
      await client.downloadAsBytes(key);

    if (!downloaded) {
      console.warn(`⚠️ Failed to download key ${key}:`, downloadErr);
      continue;
    }

    fs.writeFileSync(exportPath, Buffer.from(bytes));
    console.log(`✅ Saved → ${exportPath}`);
  }

  console.log("\n🎉 Export complete → check bucket_export/");
}

exportAll();
