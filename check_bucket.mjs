import { Client } from '@replit/object-storage';
import fs from "fs";
import path from "path";

async function exportAll() {
  console.log("🔌 Connecting to Replit Object Storage...");
  const client = new Client(); // auto bucket detection

  console.log("📦 Fetching object list...");
  const { ok, value: fileMap, error } = await client.list();
  if (!ok) {
    console.error("❌ Failed to list files:", error);
    process.exit(1);
  }

  const keys = Object.keys(fileMap);
  console.log(`📄 Found ${keys.length} files.`);

  fs.mkdirSync("bucket_export", { recursive: true });

  for (const key of keys) {
    const metadata = fileMap[key]?.metadata ?? {};
    const fileName = metadata.fileName || metadata.originalName || key; // fallback if needed

    // Ensure unique and consistent export name
    const exportName = `${key}-${fileName}`;
    const exportPath = path.join("bucket_export", exportName);

    console.log(`⬇️ Downloading: ${exportName}`);

    const { ok: downloaded, value: bytesValue, error: downloadErr } =
      await client.downloadAsBytes(key);

    if (!downloaded) {
      console.warn(`⚠️ Failed to download key ${key}:`, downloadErr?.message || downloadErr);
      continue;
    }

    fs.writeFileSync(exportPath, Buffer.from(bytesValue));
    console.log(`✅ Saved → ${exportPath}`);
  }

  console.log(`\n🎉 Export complete! Files saved in ./bucket_export`);
}



exportAll().catch(console.error);

