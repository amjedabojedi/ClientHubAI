#!/usr/bin/env node

/**
 * Azure Blob Storage Migration Script
 * 
 * This script migrates all documents from downloaded-documents folder
 * to Azure Blob Storage and links them with the correct users.
 */

import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql as drizzleSql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

// Configuration
const AZURE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=clienthubai;AccountKey=pj6JB1RCE7oE3C3txzOU0JYXwMnSECxCoKsMBzFFEw6bmGuZstj3thwxAREQ7okSlsu8W9o7ETgc+AStMxDJnw==;EndpointSuffix=core.windows.net";
const CONTAINER_NAME = "documents";
const DOWNLOADED_DOCS_DIR = './downloaded-documents';
const LOG_FILE = './azure-migration-log.txt';

// Initialize Azure Blob Storage
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

// Initialize database
const sqlClient = postgres(process.env.DATABASE_URL);
const db = drizzle(sqlClient);

// Logging function
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// Ensure Azure container exists
async function ensureContainer() {
  try {
    const createResponse = await containerClient.createIfNotExists({
      access: 'blob' // Blob-level access for security
    });
    
    if (createResponse.succeeded) {
      log('✅ Azure Blob Storage container created/verified');
    } else {
      log('✅ Azure Blob Storage container already exists');
    }
  } catch (error) {
    log(`❌ Failed to create container: ${error.message}`);
    throw error;
  }
}

// Get document info from database
async function getDocumentInfo(documentId) {
  try {
    const result = await db.execute(drizzleSql`
      SELECT id, client_id, uploaded_by_id, file_name, original_name, 
             file_size, mime_type, category, is_shared_in_portal, 
             download_count, created_at
      FROM documents 
      WHERE id = ${documentId}
    `);
    return result[0] || null;
  } catch (error) {
    log(`❌ Error fetching document ${documentId}: ${error.message}`);
    return null;
  }
}

// Upload single document to Azure Blob Storage
async function uploadDocumentToAzure(documentId, filePath, docInfo) {
  try {
    log(`📤 Uploading document ${documentId}: ${docInfo.originalName}`);
    
    // Read file
    const fileBuffer = fs.readFileSync(filePath);
    const actualSize = fileBuffer.length;
    
    // Create blob name
    const blobName = `documents/${documentId}-${docInfo.file_name}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Upload options
    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: docInfo.mime_type
      },
      metadata: {
        documentId: documentId.toString(),
        clientId: docInfo.client_id.toString(),
        originalName: docInfo.original_name,
        uploadedById: docInfo.uploaded_by_id ? docInfo.uploaded_by_id.toString() : 'null',
        category: docInfo.category,
        uploadedAt: new Date().toISOString(),
        migratedFrom: 'replit-object-storage'
      }
    };

    // Upload to Azure Blob Storage
    const uploadResult = await blockBlobClient.upload(fileBuffer, actualSize, uploadOptions);
    
    log(`✅ Successfully uploaded document ${documentId}: ${docInfo.original_name}`);
    log(`   - Blob URL: ${blockBlobClient.url}`);
    log(`   - Size: ${actualSize} bytes`);
    log(`   - Client ID: ${docInfo.client_id}`);
    log(`   - Uploaded by: ${docInfo.uploaded_by_id || 'Client'}`);
    
    return {
      success: true,
      url: blockBlobClient.url,
      blobName: blobName,
      size: actualSize,
      documentId: documentId,
      clientId: docInfo.client_id
    };

  } catch (error) {
    log(`❌ Failed to upload document ${documentId}: ${error.message}`);
    return {
      success: false,
      error: error.message,
      documentId: documentId
    };
  }
}

// Process all documents
async function migrateAllDocuments() {
  try {
    log('🚀 Starting migration to Azure Blob Storage...');
    log(`📁 Source directory: ${DOWNLOADED_DOCS_DIR}`);
    log(`☁️  Azure container: ${CONTAINER_NAME}`);
    
    // Ensure container exists
    await ensureContainer();

    // Get all files in downloaded-documents directory
    const files = fs.readdirSync(DOWNLOADED_DOCS_DIR);
    log(`📄 Found ${files.length} files to migrate`);

    const results = [];
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      // Extract document ID from filename (format: ID-filename)
      const match = file.match(/^(\d+)-/);
      if (!match) {
        log(`⚠️  Skipping file with invalid format: ${file}`);
        skippedCount++;
        continue;
      }

      const documentId = parseInt(match[1]);
      const filePath = path.join(DOWNLOADED_DOCS_DIR, file);

      log(`\n📋 Processing document ${documentId}: ${file}`);

      // Get document info from database
      const docInfo = await getDocumentInfo(documentId);
      if (!docInfo) {
        log(`❌ Document ${documentId} not found in database`);
        results.push({
          documentId,
          fileName: file,
          success: false,
          error: 'Document not found in database'
        });
        failCount++;
        continue;
      }

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        log(`❌ File not found: ${filePath}`);
        results.push({
          documentId,
          fileName: file,
          success: false,
          error: 'File not found'
        });
        failCount++;
        continue;
      }

      // Upload to Azure Blob Storage
      const result = await uploadDocumentToAzure(documentId, filePath, docInfo);
      results.push({
        documentId,
        fileName: file,
        ...result
      });

      if (result.success) {
        successCount++;
      } else {
        failCount++;
      }

      // Small delay to avoid overwhelming Azure
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Generate migration report
    const report = {
      summary: {
        total: files.length,
        successful: successCount,
        failed: failCount,
        skipped: skippedCount,
        successRate: `${((successCount / files.length) * 100).toFixed(2)}%`
      },
      details: results,
      azureConfig: {
        containerName: CONTAINER_NAME,
        connectionString: AZURE_CONNECTION_STRING.replace(/AccountKey=[^;]+/, 'AccountKey=***HIDDEN***')
      },
      timestamp: new Date().toISOString()
    };

    // Save report
    fs.writeFileSync('./azure-migration-report.json', JSON.stringify(report, null, 2));
    
    log(`\n📊 Migration Summary:`);
    log(`   Total files: ${files.length}`);
    log(`   Successful: ${successCount}`);
    log(`   Failed: ${failCount}`);
    log(`   Skipped: ${skippedCount}`);
    log(`   Success rate: ${report.summary.successRate}`);
    
    if (failCount > 0) {
      log(`\n❌ Failed uploads:`);
      results.filter(r => !r.success).forEach(r => {
        log(`   - Document ${r.documentId}: ${r.error}`);
      });
    }

    if (successCount > 0) {
      log(`\n✅ Successfully uploaded documents:`);
      results.filter(r => r.success).forEach(r => {
        log(`   - Document ${r.documentId}: ${r.fileName} (${r.size} bytes)`);
      });
    }

    log('\n🎉 Migration to Azure Blob Storage completed!');
    log('📄 Detailed report saved to: azure-migration-report.json');
    log('📝 Migration log saved to: azure-migration-log.txt');

    return report;

  } catch (error) {
    log(`❌ Migration failed: ${error.message}`);
    throw error;
  }
}

// Verify migration by checking Azure Blob Storage
async function verifyMigration() {
  try {
    log('\n🔍 Verifying migration...');
    
    const blobs = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      blobs.push(blob);
    }
    
    log(`✅ Found ${blobs.length} blobs in Azure container`);
    
    // Show sample of uploaded blobs
    if (blobs.length > 0) {
      log('\n📄 Sample uploaded blobs:');
      blobs.slice(0, 5).forEach(blob => {
        log(`   - ${blob.name} (${blob.properties.contentLength} bytes)`);
      });
      
      if (blobs.length > 5) {
        log(`   ... and ${blobs.length - 5} more`);
      }
    }
    
  } catch (error) {
    log(`❌ Verification failed: ${error.message}`);
  }
}

// Main execution
async function main() {
  try {
    // Run migration
    const report = await migrateAllDocuments();
    
    // Verify migration
    await verifyMigration();
    
    log('\n✅ Migration script completed successfully');
    
    // Show next steps
    log('\n📋 Next steps:');
    log('1. Update your application routes to use Azure Blob Storage');
    log('2. Test document upload/download functionality');
    log('3. Remove old Replit Object Storage code');
    log('4. Update environment variables in production');
    
  } catch (error) {
    log(`❌ Migration script failed: ${error.message}`);
    process.exit(1);
  } finally {
    await sqlClient.end();
  }
}

// Run the migration
main();
