#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { Client } from "@replit/object-storage";

async function exportAll() {
  console.log("🔌 Connecting to Replit Object Storage...");
  const storage = new Client();

  console.log("📦 Getting full object list...");
  const { ok, value: objects, error } = await storage.list();
  if (!ok) {
    console.error("❌ Could not list objects:", error);
    process.exit(1);
  }

  console.log(`📄 Found ${objects.length} stored objects.`);

  fs.mkdirSync("bucket_export", { recursive: true });

  for (const obj of objects) {
    const objectKey = obj.key; // FULL key (e.g., "documents/1208-contract.pdf")

    // if (!objectKey.startsWith("documents/")) {
    //   // Skip anything not part of documents store
    //   continue;
    // }

    // Extract filename from key
    //const fileName = objectKey.replace("documents/", "");

    const exportPath = path.join("bucket_export", objectKey);

    console.log(`⬇️ Downloading: ${objectKey}`);

    const { ok: downloaded, value: bytes, error: downloadErr } =
      await storage.downloadAsBytes(objectKey);

    if (!downloaded) {
      console.warn(`⚠️ Could not download ${objectKey}:`, downloadErr?.message || downloadErr);
      continue;
    }

    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    fs.writeFileSync(exportPath, Buffer.from(bytes));

    console.log(`✅ Saved → ${exportPath}`);
  }

  console.log("\n🎉 Export completed. Files are in ./bucket_export/");
}

exportAll();
