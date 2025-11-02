import { Client } from "@replit/object-storage";
import fs from "fs";

async function checkStorage() {
  try {
    const storage = new Client({
      bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8",
    });
    
    console.log("Checking Replit Object Storage...");
    const keys = await storage.list();
    
    console.log(`\nFound ${keys.length} files in Replit Object Storage\n`);
    
    if (keys.length > 0) {
      console.log("First 20 files:");
      keys.slice(0, 20).forEach(key => console.log(`  - ${key}`));
      
      // Get total size
      let totalSize = 0;
      for (const key of keys.slice(0, 100)) {
        try {
          const data = await storage.get(key);
          if (data) {
            totalSize += data.length;
          }
        } catch (e) {
          // Skip
        }
      }
      console.log(`\nEstimated total size (first 100 files): ${Math.round(totalSize / 1024 / 1024)} MB`);
    } else {
      console.log("No files found in Replit Object Storage");
    }
  } catch (error) {
    console.error("Error accessing Replit Object Storage:", error.message);
  }
}

checkStorage();
