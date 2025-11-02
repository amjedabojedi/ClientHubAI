import { Client } from '@replit/object-storage';

async function verifyReplitStorage() {
  try {
    const storage = new Client();
    
    console.log("📦 Checking Replit Object Storage...\n");
    console.log("=".repeat(60));
    
    // Test a few known document IDs
    const testIds = [1000, 1001, 1002, 1010, 1100, 1200, 1299];
    let foundCount = 0;
    let notFoundCount = 0;
    
    for (const docId of testIds) {
      const objectKey = `documents/${docId}-BAI`;
      try {
        const result = await storage.downloadAsText(objectKey);
        if (result.ok) {
          foundCount++;
          console.log(`✅ Document ${docId} - FOUND in Replit`);
        } else {
          notFoundCount++;
          console.log(`❌ Document ${docId} - NOT FOUND in Replit`);
        }
      } catch (e) {
        notFoundCount++;
        console.log(`❌ Document ${docId} - NOT FOUND in Replit`);
      }
    }
    
    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n📊 Results:`);
    console.log(`   Found in Replit: ${foundCount}`);
    console.log(`   Not found: ${notFoundCount}`);
    
    if (foundCount > 0 && notFoundCount > 0) {
      console.log(`\n⚠️  Files exist in BOTH Replit AND Azure (duplicates)`);
    } else if (foundCount === 0) {
      console.log(`\n✅ Files were MOVED from Replit to Azure (no duplicates)`);
    } else {
      console.log(`\n⚠️  Files still in Replit storage`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

verifyReplitStorage();
