#!/usr/bin/env node

/**
 * Document Discovery Script
 * 
 * This script checks what documents are available in Replit Object Storage
 * and tests the connection before running the full migration.
 */

import { Client } from '@replit/object-storage';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { documents } from './shared/schema.js';

const REPLIT_BUCKET_ID = "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8";

// Initialize database connection
const sql = postgres(process.env.DATABASE_URL);
const db = drizzle(sql);

async function discoverDocuments() {
  console.log('🔍 Discovering documents in Replit Object Storage...\n');
  
  try {
    // Initialize storage client
    const objectStorage = new Client({ bucketId: REPLIT_BUCKET_ID });
    console.log('✅ Connected to Replit Object Storage');
    
    // Get all documents from database
    const allDocs = await db.select().from(documents);
    console.log(`📊 Found ${allDocs.length} documents in database\n`);
    
    if (allDocs.length === 0) {
      console.log('No documents found in database.');
      return;
    }
    
    // Test a few documents to see what's available
    console.log('🧪 Testing document availability...\n');
    
    let availableCount = 0;
    let unavailableCount = 0;
    const sampleSize = Math.min(10, allDocs.length);
    
    for (let i = 0; i < sampleSize; i++) {
      const doc = allDocs[i];
      const objectKey = `documents/${doc.id}-${doc.fileName}`;
      
      try {
        const result = await objectStorage.downloadAsText(objectKey);
        
        if (result.ok) {
          const size = Buffer.from(result.value, 'base64').length;
          console.log(`✅ ${doc.id}: ${doc.originalName} (${size} bytes)`);
          availableCount++;
        } else {
          console.log(`❌ ${doc.id}: ${doc.originalName} - ${result.error}`);
          unavailableCount++;
        }
      } catch (error) {
        console.log(`❌ ${doc.id}: ${doc.originalName} - Error: ${error}`);
        unavailableCount++;
      }
    }
    
    console.log(`\n📈 Sample Results (${sampleSize} documents):`);
    console.log(`   Available: ${availableCount}`);
    console.log(`   Unavailable: ${unavailableCount}`);
    
    if (availableCount > 0) {
      console.log(`\n🎯 Ready to migrate! Run: node migrate-documents.mjs`);
    } else {
      console.log(`\n⚠️  No documents found in storage. Check your connection.`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sql.end();
  }
}

// Run discovery
discoverDocuments();
