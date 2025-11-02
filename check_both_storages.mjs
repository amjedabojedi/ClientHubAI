import { Client } from '@replit/object-storage';
import { BlobServiceClient } from '@azure/storage-blob';
import postgres from 'postgres';

async function checkBothStorages() {
  try {
    const sql = postgres(process.env.DATABASE_URL);
    
    // Get sample documents
    const docs = await sql`
      SELECT id, file_name 
      FROM documents 
      WHERE id IN (1000, 1001, 1002, 1010, 1100, 1200, 1299)
      ORDER BY id
    `;
    
    console.log("🔍 Checking where files actually exist...\n");
    console.log("=".repeat(70));
    
    const replitStorage = new Client();
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const containerClient = blobServiceClient.getContainerClient('documents');
    
    let inReplitOnly = 0;
    let inAzureOnly = 0;
    let inBoth = 0;
    let inNeither = 0;
    
    for (const doc of docs) {
      const objectKey = `documents/${doc.id}-${doc.file_name}`;
      
      // Check Replit
      let inReplit = false;
      try {
        const replitResult = await replitStorage.downloadAsText(objectKey);
        inReplit = replitResult.ok;
      } catch (e) {
        inReplit = false;
      }
      
      // Check Azure
      let inAzure = false;
      try {
        const blobClient = containerClient.getBlobClient(objectKey);
        const exists = await blobClient.exists();
        inAzure = exists;
      } catch (e) {
        inAzure = false;
      }
      
      let status = '';
      if (inReplit && inAzure) {
        status = '✅ BOTH storages';
        inBoth++;
      } else if (inReplit) {
        status = '🔵 Replit ONLY';
        inReplitOnly++;
      } else if (inAzure) {
        status = '🟢 Azure ONLY';
        inAzureOnly++;
      } else {
        status = '❌ NEITHER';
        inNeither++;
      }
      
      console.log(`Doc ${doc.id} (${doc.file_name}): ${status}`);
    }
    
    console.log(`\n${"=".repeat(70)}`);
    console.log(`\n📊 Summary:`);
    console.log(`   In Azure only: ${inAzureOnly}`);
    console.log(`   In Replit only: ${inReplitOnly}`);
    console.log(`   In BOTH: ${inBoth}`);
    console.log(`   In NEITHER: ${inNeither}`);
    
    if (inAzureOnly > inReplitOnly) {
      console.log(`\n✅ Most files have been migrated to Azure!`);
    }
    
    await sql.end();
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkBothStorages();
