#!/usr/bin/env node

/**
 * Direct Azure Blob Storage Upload Script
 * 
 * This script uploads documents directly to Azure Blob Storage
 * using the information from download-report.json
 */

import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import fs from 'fs';
import path from 'path';

// Configuration
const AZURE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=clienthubai;AccountKey=pj6JB1RCE7oE3C3txzOU0JYXwMnSECxCoKsMBzFFEw6bmGuZstj3thwxAREQ7okSlsu8W9o7ETgc+AStMxDJnw==;EndpointSuffix=core.windows.net";
const CONTAINER_NAME = "documents";
const DOWNLOADED_DOCS_DIR = './downloaded-documents';
const DOWNLOAD_REPORT_FILE = './download-report.json';
const LOG_FILE = './azure-direct-upload-log.txt';

// Initialize Azure Blob Storage
const blobServiceClient = BlobServiceClient.fromConnectionString(AZURE_CONNECTION_STRING);
const containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

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

// Upload single document to Azure Blob Storage
async function uploadDocumentToAzure(documentInfo, filePath) {
  try {
    log(`📤 Uploading document ${documentInfo.id}: ${documentInfo.originalName}`);
    
    // Read file
    const fileBuffer = fs.readFileSync(filePath);
    const actualSize = fileBuffer.length;
    
    // Create blob name
    const blobName = `documents/${documentInfo.id}-${documentInfo.fileName}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Upload options
    const uploadOptions = {
      blobHTTPHeaders: {
        blobContentType: documentInfo.mimeType
      },
      metadata: {
        documentId: documentInfo.id.toString(),
        clientId: documentInfo.clientId.toString(),
        originalName: documentInfo.originalName,
        uploadedById: documentInfo.uploadedById ? documentInfo.uploadedById.toString() : 'null',
        category: documentInfo.category,
        uploadedAt: new Date().toISOString(),
        migratedFrom: 'replit-object-storage'
      }
    };

    // Upload to Azure Blob Storage
    const uploadResult = await blockBlobClient.upload(fileBuffer, actualSize, uploadOptions);
    
    log(`✅ Successfully uploaded document ${documentInfo.id}: ${documentInfo.originalName}`);
    log(`   - Blob URL: ${blockBlobClient.url}`);
    log(`   - Size: ${actualSize} bytes`);
    log(`   - Client ID: ${documentInfo.clientId}`);
    log(`   - Uploaded by: ${documentInfo.uploadedById || 'Client'}`);
    
    return {
      success: true,
      url: blockBlobClient.url,
      blobName: blobName,
      size: actualSize,
      documentId: documentInfo.id,
      clientId: documentInfo.clientId
    };

  } catch (error) {
    log(`❌ Failed to upload document ${documentInfo.id}: ${error.message}`);
    return {
      success: false,
      error: error.message,
      documentId: documentInfo.id
    };
  }
}

// Main migration function
async function migrateDocumentsFromReport() {
  try {
    log('🚀 Starting direct migration to Azure Blob Storage...');
    log(`📁 Source directory: ${DOWNLOADED_DOCS_DIR}`);
    log(`☁️  Azure container: ${CONTAINER_NAME}`);
    
    // Ensure container exists
    await ensureContainer();

    // Read download report
    const reportData = JSON.parse(fs.readFileSync(DOWNLOAD_REPORT_FILE, 'utf8'));
    const successfulDownloads = reportData.details.filter(d => d.success);
    
    log(`📄 Found ${successfulDownloads.length} successful downloads to migrate`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const download of successfulDownloads) {
      const documentInfo = download.document;
      const fileName = download.localPath.split('/').pop(); // Extract filename from path
      const filePath = path.join(DOWNLOADED_DOCS_DIR, fileName);

      log(`\n📋 Processing document ${documentInfo.id}: ${fileName}`);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        log(`❌ File not found: ${filePath}`);
        results.push({
          documentId: documentInfo.id,
          fileName: fileName,
          success: false,
          error: 'File not found'
        });
        failCount++;
        continue;
      }

      // Upload to Azure Blob Storage
      const result = await uploadDocumentToAzure(documentInfo, filePath);
      results.push({
        documentId: documentInfo.id,
        fileName: fileName,
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
        total: successfulDownloads.length,
        successful: successCount,
        failed: failCount,
        successRate: `${((successCount / successfulDownloads.length) * 100).toFixed(2)}%`
      },
      details: results,
      azureConfig: {
        containerName: CONTAINER_NAME,
        connectionString: AZURE_CONNECTION_STRING.replace(/AccountKey=[^;]+/, 'AccountKey=***HIDDEN***')
      },
      timestamp: new Date().toISOString()
    };

    // Save report
    fs.writeFileSync('./azure-direct-upload-report.json', JSON.stringify(report, null, 2));
    
    log(`\n📊 Migration Summary:`);
    log(`   Total files: ${successfulDownloads.length}`);
    log(`   Successful: ${successCount}`);
    log(`   Failed: ${failCount}`);
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

    log('\n🎉 Direct migration to Azure Blob Storage completed!');
    log('📄 Detailed report saved to: azure-direct-upload-report.json');
    log('📝 Migration log saved to: azure-direct-upload-log.txt');

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
      blobs.slice(0, 10).forEach(blob => {
        log(`   - ${blob.name} (${blob.properties.contentLength} bytes)`);
      });
      
      if (blobs.length > 10) {
        log(`   ... and ${blobs.length - 10} more`);
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
    const report = await migrateDocumentsFromReport();
    
    // Verify migration
    await verifyMigration();
    
    log('\n✅ Direct upload script completed successfully');
    
    // Show next steps
    log('\n📋 Next steps:');
    log('1. Update your application routes to use Azure Blob Storage');
    log('2. Test document upload/download functionality');
    log('3. Remove old Replit Object Storage code');
    log('4. Update environment variables in production');
    
  } catch (error) {
    log(`❌ Direct upload script failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the migration
main();
