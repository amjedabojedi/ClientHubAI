import { Client } from "@replit/object-storage";

async function exploreStorage() {
  try {
    const storage = new Client({
      bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8",
    });
    
    console.log("📁 Accessing Replit Object Storage...\n");
    
    // List all keys
    const keysIterator = await storage.list();
    const keys = [];
    
    // Convert async iterator to array
    for await (const key of keysIterator) {
      keys.push(key);
    }
    
    if (keys.length === 0) {
      console.log("No files found in storage.");
      return;
    }
    
    console.log(`✅ Found ${keys.length} files in Replit Object Storage\n`);
    console.log("=".repeat(80));
    
    // Sort keys
    keys.sort();
    
    let totalSize = 0;
    const fileDetails = [];
    
    // Get details for first 100 files
    for (let i = 0; i < Math.min(100, keys.length); i++) {
      const key = keys[i];
      try {
        const data = await storage.get(key);
        const size = data ? data.length : 0;
        totalSize += size;
        
        fileDetails.push({
          index: i + 1,
          key,
          size,
          sizeMB: (size / 1024 / 1024).toFixed(2)
        });
      } catch (e) {
        fileDetails.push({
          index: i + 1,
          key,
          size: 0,
          sizeMB: 'ERROR',
          error: e.message
        });
      }
    }
    
    // Display results
    console.log("\n📋 First 100 Files:\n");
    fileDetails.forEach(file => {
      const filename = file.key.replace('documents/', '');
      if (file.error) {
        console.log(`${file.index}. ${filename} - ERROR: ${file.error}`);
      } else {
        console.log(`${file.index}. ${filename} - ${file.sizeMB} MB`);
      }
    });
    
    if (keys.length > 100) {
      console.log(`\n... and ${keys.length - 100} more files`);
    }
    
    console.log("\n" + "=".repeat(80));
    console.log(`\n📊 Summary:`);
    console.log(`   Total Files: ${keys.length}`);
    console.log(`   Scanned: ${fileDetails.length} files`);
    console.log(`   Total Size (scanned): ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    
    // Extract document IDs
    const docIds = keys.map(k => {
      const match = k.match(/documents\/(\d+)-/);
      return match ? parseInt(match[1]) : null;
    }).filter(id => id !== null).sort((a, b) => a - b);
    
    if (docIds.length > 0) {
      console.log(`   Document ID Range: ${docIds[0]} - ${docIds[docIds.length - 1]}`);
      console.log(`   Unique Document IDs: ${new Set(docIds).size}`);
    }
    
  } catch (error) {
    console.error("❌ Error accessing Replit Object Storage:", error.message);
    console.error("Full error:", error);
  }
}

exploreStorage();
