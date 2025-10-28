#!/usr/bin/env node

/**
 * Migrate All Missing Documents Script
 * 
 * This script finds all documents that exist in the database but not in Azure Blob Storage,
 * downloads them from Replit Object Storage, and uploads them to Azure Blob Storage.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { BlobServiceClient } from '@azure/storage-blob';

// Initialize database
const sqlClient = postgres(process.env.DATABASE_URL);
const db = drizzle(sqlClient);

// Initialize Azure Blob Storage
const AZURE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = process.env.AZURE_BLOB_CONTAINER_NAME || 'documents';
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

function generateBlobName(documentId, fileName) {
  return `documents/${documentId}-${fileName}`;
}

async function fileExists(blobName) {
  try {
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.getProperties();
    return true;
  } catch (error) {
    return false;
  }
}

async function downloadFromReplit(documentId, fileName) {
  try {
    const { Client } = await import('@replit/object-storage');
    const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
    const objectKey = `documents/${documentId}-${fileName}`;
    
    const downloadResult = await objectStorage.downloadAsText(objectKey);
    
    if (downloadResult.ok) {
      const buffer = Buffer.from(downloadResult.value, 'base64');
      return buffer;
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }
}

async function uploadToAzure(documentId, fileName, mimeType, buffer, metadata) {
  try {
    const blobName = generateBlobName(documentId, fileName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: mimeType
      },
      metadata: {
        documentId: documentId.toString(),
        clientId: metadata.clientId.toString(),
        originalName: metadata.originalName,
        uploadedById: metadata.uploadedById ? metadata.uploadedById.toString() : 'null',
        category: metadata.category,
        uploadedAt: new Date().toISOString(),
        migratedFrom: 'replit-object-storage'
      }
    };

    await blockBlobClient.upload(buffer, buffer.length, uploadOptions);
    return { success: true, blobName, size: buffer.length };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function migrateMissingDocuments() {
  try {
    console.log('🔍 Finding documents that need migration...');
    
    // Get all documents from database
    const allDocs = await db.execute(sql`
      SELECT id, client_id, uploaded_by_id, file_name, original_name, 
             file_size, mime_type, category, created_at
      FROM documents 
      ORDER BY id DESC
    `);
    
    console.log(`📋 Found ${allDocs.length} documents in database`);
    
    const missingDocs = [];
    
    // Check which documents are missing from Azure Blob Storage
    for (const doc of allDocs) {
      const blobName = generateBlobName(doc.id, doc.file_name);
      const exists = await fileExists(blobName);
      
      if (!exists) {
        missingDocs.push(doc);
        console.log(`❌ Missing: Document ${doc.id} - ${doc.original_name}`);
      } else {
        console.log(`✅ Found: Document ${doc.id} - ${doc.original_name}`);
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total documents: ${allDocs.length}`);
    console.log(`   In Azure Blob Storage: ${allDocs.length - missingDocs.length}`);
    console.log(`   Missing from Azure: ${missingDocs.length}`);
    
    if (missingDocs.length === 0) {
      console.log('🎉 All documents are already in Azure Blob Storage!');
      return;
    }
    
    console.log(`\n🚀 Starting migration of ${missingDocs.length} missing documents...`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (const doc of missingDocs) {
      console.log(`\n📋 Processing document ${doc.id}: ${doc.original_name}`);
      
      // Download from Replit Object Storage
      const buffer = await downloadFromReplit(doc.id, doc.file_name);
      if (!buffer) {
        console.log(`❌ Failed to download document ${doc.id} from Replit`);
        failCount++;
        continue;
      }
      
      console.log(`✅ Downloaded ${buffer.length} bytes from Replit`);
      
      // Upload to Azure Blob Storage
      const uploadResult = await uploadToAzure(
        doc.id,
        doc.file_name,
        doc.mime_type,
        buffer,
        {
          clientId: doc.client_id,
          originalName: doc.original_name,
          uploadedById: doc.uploaded_by_id,
          category: doc.category
        }
      );
      
      if (uploadResult.success) {
        console.log(`✅ Successfully uploaded document ${doc.id} to Azure Blob Storage`);
        successCount++;
      } else {
        console.log(`❌ Failed to upload document ${doc.id}: ${uploadResult.error}`);
        failCount++;
      }
      
      // Small delay to avoid overwhelming Azure
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`\n📊 Migration Summary:`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`   Success rate: ${((successCount / missingDocs.length) * 100).toFixed(2)}%`);
    
    if (successCount > 0) {
      console.log('\n🎉 Migration completed! All documents should now be accessible.');
    }
    
  } catch (error) {
    console.error(`❌ Migration failed: ${error.message}`);
  }
}

async function main() {
  try {
    await migrateMissingDocuments();
  } catch (error) {
    console.error(`❌ Script failed: ${error.message}`);
  } finally {
    await sqlClient.end();
  }
}

main();
