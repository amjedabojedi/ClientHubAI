import { BlobServiceClient } from '@azure/storage-blob';
import postgres from 'postgres';

async function checkAzureStorage() {
  try {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    
    if (!connectionString) {
      console.log("❌ Azure storage not configured");
      return;
    }

    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    const containerClient = blobServiceClient.getContainerClient('documents');
    
    console.log("📦 Checking Azure Blob Storage...\n");
    console.log("=".repeat(60));
    
    const blobs = [];
    
    for await (const blob of containerClient.listBlobsFlat()) {
      blobs.push(blob.name);
    }
    
    console.log(`\n✅ Found ${blobs.length} files in Azure Storage\n`);
    
    // Extract document IDs
    const docIds = blobs.map(name => {
      const match = name.match(/documents\/(\d+)-/);
      return match ? parseInt(match[1]) : null;
    }).filter(id => id !== null).sort((a, b) => a - b);
    
    if (docIds.length > 0) {
      console.log(`Document ID Range: ${docIds[0]} - ${docIds[docIds.length - 1]}`);
      console.log(`Unique Documents: ${new Set(docIds).size}`);
    }
    
    // Show first 20 files
    console.log(`\n📄 First 20 files:\n`);
    blobs.slice(0, 20).forEach((name, i) => {
      console.log(`${i + 1}. ${name}`);
    });
    
    if (blobs.length > 20) {
      console.log(`\n... and ${blobs.length - 20} more files`);
    }
    
    // Check database for total documents
    const sql = postgres(process.env.DATABASE_URL);
    const result = await sql`SELECT COUNT(*) as total FROM documents`;
    const totalInDB = parseInt(result[0].total);
    
    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n📊 Summary:`);
    console.log(`   Files in Azure: ${blobs.length}`);
    console.log(`   Documents in Database: ${totalInDB}`);
    console.log(`   Files in Replit: ~${totalInDB - blobs.length} (estimated)`);
    
    await sql.end();
    
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

checkAzureStorage();
