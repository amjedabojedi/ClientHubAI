const { Client } = require("@replit/object-storage");

async function exportAll() {
  const storage = new Client({
    bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8",
  });
  const keys = await storage.list();

  console.log("Found", keys.length, "files.");

  fs.mkdirSync("bucket_export", { recursive: true });

  for (const key of keys) {
    const data = await storage.get(key);
    const filePath = `bucket_export/${key}`;
    fs.mkdirSync(filePath.split("/").slice(0, -1).join("/"), {
      recursive: true,
    });
    fs.writeFileSync(filePath, data);
    console.log("Downloaded:", key);
  }

  console.log("\n✅ All bucket files saved to /bucket_export");
}

exportAll();

checkDocument().catch(console.error);
