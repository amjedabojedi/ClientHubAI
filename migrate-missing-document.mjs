#!/usr/bin/env node

/**
 * Migrate Missing Document Script
 * 
 * This script downloads a specific document from Replit Object Storage
 * and uploads it to Azure Blob Storage
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { BlobServiceClient } from '@azure/storage-blob';
import fs from 'fs';

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

async function downloadFromReplit(documentId, fileName) {
  try {
    console.log(`📥 Downloading document ${documentId} from Replit Object Storage...`);
    
    const { Client } = await import('@replit/object-storage');
    const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
    const objectKey = `documents/${documentId}-${fileName}`;
    
    const downloadResult = await objectStorage.downloadAsText(objectKey);
    
    if (downloadResult.ok) {
      // Convert base64 to buffer
      const buffer = Buffer.from(downloadResult.value, 'base64');
      console.log(`✅ Downloaded ${buffer.length} bytes from Replit`);
      return buffer;
    } else {
      console.log(`❌ Failed to download from Replit: ${downloadResult.error}`);
      return null;
    }
  } catch (error) {
    console.log(`❌ Error downloading from Replit: ${error.message}`);
    return null;
  }
}

async function uploadToAzure(documentId, fileName, mimeType, buffer, metadata) {
  try {
    console.log(`📤 Uploading document ${documentId} to Azure Blob Storage...`);
    
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

    const uploadResult = await blockBlobClient.upload(buffer, buffer.length, uploadOptions);
    
    console.log(`✅ Successfully uploaded to Azure Blob Storage`);
    console.log(`   - Blob URL: ${blockBlobClient.url}`);
    console.log(`   - Size: ${buffer.length} bytes`);
    
    return {
      success: true,
      url: blockBlobClient.url,
      blobName: blobName,
      size: buffer.length
    };

  } catch (error) {
    console.log(`❌ Failed to upload to Azure: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

async function migrateDocument(documentId) {
  try {
    console.log(`🚀 Starting migration for document ${documentId}...`);
    
    // Get document info from database
    const result = await db.execute(sql`
      SELECT id, client_id, uploaded_by_id, file_name, original_name, 
             file_size, mime_type, category, is_shared_in_portal, 
             download_count, created_at
      FROM documents 
      WHERE id = ${documentId}
    `);
    
    if (result.length === 0) {
      console.log(`❌ Document ${documentId} not found in database`);
      return;
    }
    
    const doc = result[0];
    console.log(`📋 Document info:`);
    console.log(`   - ID: ${doc.id}`);
    console.log(`   - Client ID: ${doc.client_id}`);
    console.log(`   - File Name: ${doc.file_name}`);
    console.log(`   - Original Name: ${doc.original_name}`);
    console.log(`   - MIME Type: ${doc.mime_type}`);
    console.log(`   - Size: ${doc.file_size} bytes`);
    
    // Download from Replit Object Storage
    const buffer = await downloadFromReplit(doc.id, doc.file_name);
    if (!buffer) {
      console.log(`❌ Failed to download document from Replit`);
      return;
    }
    
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
      console.log(`🎉 Document ${documentId} successfully migrated to Azure Blob Storage!`);
    } else {
      console.log(`❌ Failed to migrate document ${documentId}`);
    }
    
  } catch (error) {
    console.error(`❌ Migration failed: ${error.message}`);
  }
}

async function main() {
  try {
    const documentId = process.argv[2];
    
    if (!documentId) {
      console.log('Usage: node migrate-missing-document.mjs <documentId>');
      process.exit(1);
    }
    
    await migrateDocument(parseInt(documentId));
    
  } catch (error) {
    console.error(`❌ Script failed: ${error.message}`);
  } finally {
    await sqlClient.end();
  }
}

main();
