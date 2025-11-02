import { Client } from '@replit/object-storage';
import fs from 'fs';
import postgres from 'postgres';

async function testFixOneFile() {
  try {
    const storage = new Client();
    const sql = postgres(process.env.DATABASE_URL);
    
    const testDocId = 1000;
    
    console.log(`\n📄 Testing file fix for Document ID: ${testDocId}\n`);
    console.log("=".repeat(60));
    
    // Get document info from database
    const result = await sql`
      SELECT id, file_name, original_name, mime_type 
      FROM documents 
      WHERE id = ${testDocId}
    `;
    
    if (result.length === 0) {
      console.log(`❌ Document ${testDocId} not found in database`);
      await sql.end();
      return;
    }
    
    const doc = result[0];
    
    console.log(`\n✅ Found in database:`);
    console.log(`   Original Name: ${doc.original_name}`);
    console.log(`   File Name (storage): ${doc.file_name}`);
    console.log(`   MIME Type: ${doc.mime_type}`);
    
    // Download from Replit Storage (without extension)
    const objectKey = `documents/${doc.id}-${doc.file_name}`;
    console.log(`\n📥 Downloading from: ${objectKey}`);
    
    const downloadResult = await storage.downloadAsText(objectKey);
    
    if (!downloadResult.ok) {
      console.log(`❌ Failed to download: ${downloadResult.error}`);
      await sql.end();
      return;
    }
    
    console.log(`✅ File downloaded successfully!`);
    
    // Convert from base64 to binary
    const binaryData = Buffer.from(downloadResult.value, 'base64');
    console.log(`   Size: ${(binaryData.length / 1024 / 1024).toFixed(2)} MB`);
    
    // Save with CORRECT extension
    const extension = doc.original_name.split('.').pop();
    const fixedFileName = `TEST_${doc.id}-${doc.file_name}.${extension}`;
    
    fs.writeFileSync(fixedFileName, binaryData);
    
    console.log(`\n✅ File saved with extension: ${fixedFileName}`);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`\n🎉 SUCCESS! Now try to open the file:\n`);
    console.log(`   1. Look for: ${fixedFileName}`);
    console.log(`   2. Download it to your computer`);
    console.log(`   3. Double-click to open - it should work as a PDF!`);
    console.log(`\n💡 If it works, I'll update the app to fix all files.`);
    
    await sql.end();
    
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
  }
}

testFixOneFile();
