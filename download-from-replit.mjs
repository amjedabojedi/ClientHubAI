#!/usr/bin/env node

/**
 * Replit Document Downloader
 * 
 * Run this script IN REPLIT to download all documents from Object Storage
 * and prepare them for migration to a new storage system.
 * 
 * Usage in Replit: node download-from-replit.mjs
 */

import { Client } from '@replit/object-storage';
import fs from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { documents } from './shared/schema.js';

// Configuration
const DOWNLOAD_DIR = './downloaded-documents';
const LOG_FILE = './download-log.txt';

// Initialize storage client (will use default bucket in Replit)
const objectStorage = new Client();

// Initialize database connection
const sql = postgres(process.env.DATABASE_URL);
const db = drizzle(sql);

// Logging function
function log(message) {
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

// Download a single document
async function downloadDocument(doc) {
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
    
    return { success: true, localPath, size: binaryData.length };
    
  } catch (error) {
    log(`Error downloading document ${doc.id}: ${error}`);
    return { success: false, error: String(error) };
  }
}

// Generate download report
function generateReport(results) {
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalSize = results.filter(r => r.success).reduce((sum, r) => sum + (r.size || 0), 0);
  
  const report = {
    summary: {
      total: results.length,
      successful,
      failed,
      totalSize,
      successRate: `${((successful / results.length) * 100).toFixed(2)}%`
    },
    details: results,
    instructions: {
      nextSteps: [
        "1. Download the downloaded-documents folder from Replit",
        "2. Copy the files to your local project",
        "3. Implement a new storage system (local file system recommended)",
        "4. Update the application to use the new storage system"
      ]
    }
  };
  
  const reportPath = './download-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  log(`Download report saved to: ${reportPath}`);
  log(`Summary: ${successful}/${results.length} documents downloaded successfully`);
  log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  if (failed > 0) {
    log(`Failed downloads:`);
    results.filter(r => !r.success).forEach(r => {
      log(`  - Document ${r.document.id}: ${r.error}`);
    });
  }
}

// Main download function
async function downloadAllDocuments() {
  try {
    log('Starting document download from Replit Object Storage...');
    
    // Ensure download directory exists
    ensureDownloadDir();
    
    // Get all documents from database
    const allDocuments = await getAllDocuments();
    
    if (allDocuments.length === 0) {
      log('No documents found in database. Download complete.');
      return;
    }
    
    log(`Starting download of ${allDocuments.length} documents...`);
    
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
    
    log('Document download completed!');
    log(`Files saved to: ${DOWNLOAD_DIR}`);
    log('Next: Download the downloaded-documents folder from Replit to your local machine');
    
  } catch (error) {
    log(`Download failed: ${error}`);
    throw error;
  } finally {
    await sql.end();
  }
}

// Run download if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  downloadAllDocuments()
    .then(() => {
      log('Download script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      log(`Download script failed: ${error}`);
      process.exit(1);
    });
}

export { downloadAllDocuments, downloadDocument, getAllDocuments };
