#!/usr/bin/env node

/**
 * Document Migration Script
 * 
 * This script fetches all documents from Replit Object Storage
 * and downloads them to local storage for migration to a new storage system.
 * 
 * Usage: node migrate-documents.mjs
 */

import { Client } from '@replit/object-storage';
import fs from 'fs';
import path from 'path';
import { db } from './server/db.js';
import { documents } from './shared/schema.js';
import { eq } from 'drizzle-orm';

// Configuration
const REPLIT_BUCKET_ID = "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8";
const DOWNLOAD_DIR = './migrated-documents';
const LOG_FILE = './migration-log.txt';

// Initialize storage client
const objectStorage = new Client({ bucketId: REPLIT_BUCKET_ID });

// Logging function
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  
  // Also write to log file
  fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// Create download directory
function ensureDownloadDir() {
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    log(`Created download directory: ${DOWNLOAD_DIR}`);
  }
}

// Get all documents from database
async function getAllDocuments() {
  try {
    const allDocs = await db.select().from(documents);
    log(`Found ${allDocs.length} documents in database`);
    return allDocs;
  } catch (error) {
    log(`Error fetching documents from database: ${error}`);
    throw error;
  }
}

// Download a single document from Replit Object Storage
async function downloadDocument(doc: any): Promise<{ success: boolean; error?: string; localPath?: string }> {
  try {
    const objectKey = `documents/${doc.id}-${doc.fileName}`;
    log(`Attempting to download: ${objectKey}`);
    
    // Try to download the document
    const downloadResult = await objectStorage.downloadAsText(objectKey);
    
    if (!downloadResult.ok) {
      log(`Failed to download ${objectKey}: ${downloadResult.error}`);
      return { success: false, error: downloadResult.error };
    }
    
    // Convert base64 to binary
    const binaryData = Buffer.from(downloadResult.value, 'base64');
    
    // Create safe filename
    const safeFileName = doc.originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const localPath = path.join(DOWNLOAD_DIR, `${doc.id}-${safeFileName}`);
    
    // Write file to disk
    fs.writeFileSync(localPath, binaryData);
    
    log(`Successfully downloaded: ${objectKey} -> ${localPath} (${binaryData.length} bytes)`);
    
    return { success: true, localPath };
    
  } catch (error) {
    log(`Error downloading document ${doc.id}: ${error}`);
    return { success: false, error: String(error) };
  }
}

// Generate migration report
function generateReport(results: any[]) {
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  const report = {
    summary: {
      total: results.length,
      successful,
      failed,
      successRate: `${((successful / results.length) * 100).toFixed(2)}%`
    },
    details: results
  };
  
  const reportPath = './migration-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  log(`Migration report saved to: ${reportPath}`);
  log(`Summary: ${successful}/${results.length} documents downloaded successfully`);
  
  if (failed > 0) {
    log(`Failed downloads:`);
    results.filter(r => !r.success).forEach(r => {
      log(`  - Document ${r.document.id}: ${r.error}`);
    });
  }
}

// Main migration function
async function migrateDocuments() {
  try {
    log('Starting document migration from Replit Object Storage...');
    
    // Ensure download directory exists
    ensureDownloadDir();
    
    // Get all documents from database
    const allDocuments = await getAllDocuments();
    
    if (allDocuments.length === 0) {
      log('No documents found in database. Migration complete.');
      return;
    }
    
    log(`Starting migration of ${allDocuments.length} documents...`);
    
    const results = [];
    
    // Process documents one by one
    for (let i = 0; i < allDocuments.length; i++) {
      const doc = allDocuments[i];
      log(`Processing document ${i + 1}/${allDocuments.length}: ${doc.originalName}`);
      
      const result = await downloadDocument(doc);
      results.push({
        document: doc,
        ...result
      });
      
      // Small delay to avoid overwhelming the storage service
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Generate report
    generateReport(results);
    
    log('Document migration completed!');
    
  } catch (error) {
    log(`Migration failed: ${error}`);
    throw error;
  }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDocuments()
    .then(() => {
      log('Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      log(`Migration script failed: ${error}`);
      process.exit(1);
    });
}

export { migrateDocuments, downloadDocument, getAllDocuments };
