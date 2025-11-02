import { Client } from "@replit/object-storage";

async function listStorage() {
  try {
    const storage = new Client({
      bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8",
    });
    
    console.log("📁 Accessing Replit Object Storage...\n");
    
    const keys = await storage.list();
    
    if (!keys || keys.length === 0) {
      console.log("No files found in storage.");
      return;
    }
    
    console.log(`✅ Found ${keys.length} files in Replit Object Storage\n`);
    console.log("=" .repeat(80));
    
    // Sort by filename
    const sortedKeys = keys.sort();
    
    // Group by prefix (document IDs)
    const filesByPrefix = {};
    let totalSize = 0;
    
    for (const key of sortedKeys) {
      const match = key.match(/documents\/(\d+)-/);
      const docId = match ? parseInt(match[1]) : 0;
      
      if (!filesByPrefix[docId]) {
        filesByPrefix[docId] = [];
      }
      
      // Get file size
      try {
        const data = await storage.get(key);
        const size = data ? data.length : 0;
        totalSize += size;
        
        filesByPrefix[docId].push({
          key,
          size,
          sizeFormatted: (size / 1024 / 1024).toFixed(2) + ' MB'
        });
      } catch (e) {
        filesByPrefix[docId].push({
          key,
          size: 0,
          sizeFormatted: 'ERROR'
        });
      }
    }
    
    // Display grouped by document ID
    const docIds = Object.keys(filesByPrefix).map(Number).sort((a, b) => a - b);
    
    console.log("\n📋 Files by Document ID:\n");
    
    for (const docId of docIds) {
      const files = filesByPrefix[docId];
      console.log(`\n📄 Document ID: ${docId}`);
      files.forEach(file => {
        const filename = file.key.replace('documents/', '');
        console.log(`   ${filename} - ${file.sizeFormatted}`);
      });
    }
    
    console.log("\n" + "=".repeat(80));
    console.log(`\n📊 Summary:`);
    console.log(`   Total Files: ${keys.length}`);
    console.log(`   Total Size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Document IDs: ${docIds[0]} - ${docIds[docIds.length - 1]}`);
    
    // Show first 50 files in detail
    console.log(`\n\n📝 First 50 Files (detailed):\n`);
    for (let i = 0; i < Math.min(50, sortedKeys.length); i++) {
      const key = sortedKeys[i];
      const data = await storage.get(key);
      const size = data ? data.length : 0;
      console.log(`${i + 1}. ${key} - ${(size / 1024 / 1024).toFixed(2)} MB`);
    }
    
    if (sortedKeys.length > 50) {
      console.log(`\n... and ${sortedKeys.length - 50} more files`);
    }
    
  } catch (error) {
    console.error("❌ Error accessing Replit Object Storage:", error.message);
    console.error("Stack:", error.stack);
  }
}

listStorage();
