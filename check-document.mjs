#!/usr/bin/env node

/**
 * Check Document Status Script
 * 
 * This script checks if a specific document exists in the database
 * and whether it's available in Azure Blob Storage
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
const AZURE_CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING || '';
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

async function listFiles() {
  try {
    const files = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      files.push(blob.name);
    }
    return files;
  } catch (error) {
    return [];
  }
}

async function checkDocument(documentId) {
  try {
    console.log(`🔍 Checking document ${documentId}...`);
    
    // Check if document exists in database
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
    console.log(`✅ Document found in database:`);
    console.log(`   - ID: ${doc.id}`);
    console.log(`   - Client ID: ${doc.client_id}`);
    console.log(`   - File Name: ${doc.file_name}`);
    console.log(`   - Original Name: ${doc.original_name}`);
    console.log(`   - MIME Type: ${doc.mime_type}`);
    console.log(`   - Size: ${doc.file_size} bytes`);
    console.log(`   - Category: ${doc.category}`);
    console.log(`   - Created: ${doc.created_at}`);
    
    // Check if document exists in Azure Blob Storage
    const blobName = generateBlobName(doc.id, doc.file_name);
    console.log(`\n🔍 Checking Azure Blob Storage for: ${blobName}`);
    
    const exists = await fileExists(blobName);
    if (exists) {
      console.log(`✅ Document found in Azure Blob Storage`);
    } else {
      console.log(`❌ Document NOT found in Azure Blob Storage`);
      console.log(`   - Expected blob name: ${blobName}`);
      
      // List all blobs to see what's available
      console.log(`\n📄 Available blobs in Azure container:`);
      const blobs = await listFiles();
      blobs.forEach(blob => {
        console.log(`   - ${blob}`);
      });
    }
    
  } catch (error) {
    console.error(`❌ Error checking document ${documentId}:`, error.message);
  }
}

async function listAllDocuments() {
  try {
    console.log(`\n📋 All documents in database:`);
    
    const result = await db.execute(sql`
      SELECT id, client_id, file_name, original_name, file_size, mime_type, category, created_at
      FROM documents 
      ORDER BY id DESC
      LIMIT 20
    `);
    
    result.forEach(doc => {
      console.log(`   - ID: ${doc.id}, Client: ${doc.client_id}, File: ${doc.original_name}, Size: ${doc.file_size}`);
    });
    
  } catch (error) {
    console.error(`❌ Error listing documents:`, error.message);
  }
}

async function main() {
  try {
    const documentId = process.argv[2];
    
    if (documentId) {
      await checkDocument(parseInt(documentId));
    } else {
      await listAllDocuments();
    }
    
  } catch (error) {
    console.error(`❌ Script failed:`, error.message);
  } finally {
    await sqlClient.end();
  }
}

main();
