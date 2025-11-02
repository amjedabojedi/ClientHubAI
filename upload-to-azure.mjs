import fs from "fs";
import path from "path";
import { BlobServiceClient } from "@azure/storage-blob";
import "dotenv/config";

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER = process.env.AZURE_BLOB_CONTAINER_NAME || "documents";

if (!CONNECTION_STRING) {
  console.error("❌ Missing AZURE_STORAGE_CONNECTION_STRING in .env");
  process.exit(1);
}

const blobService = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
const containerClient = blobService.getContainerClient(CONTAINER);

async function ensureContainer() {
  const exists = await containerClient.exists();
  if (!exists) {
    console.log(`🫙 Creating container: ${CONTAINER}`);
    await containerClient.create();
  }
}

function walk(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results = results.concat(walk(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

async function uploadFile(filePath) {
  const blobName = filePath.replace("storage-export/", "").replace(/\\/g, "/"); // normalize path
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // ✅ Skip if already uploaded
  if (await blockBlobClient.exists()) {
    console.log(`⏭️  Already exists, skipping: ${blobName}`);
    return;
  }

  const fileData = fs.readFileSync(filePath);

  console.log(`⬆️  Uploading: ${blobName}`);
  await blockBlobClient.upload(fileData, fileData.length);
  console.log(`✅ Uploaded: ${blobName}`);
}

async function main() {
  await ensureContainer();

  const files = walk("storage-export");
  console.log(`\n📦 Found ${files.length} files to process.\n`);

  for (const file of files) {
    await uploadFile(file);
  }

  console.log(`\n🎉 Upload complete! All files synced to Azure container "${CONTAINER}".`);
}

main().catch(console.error);
