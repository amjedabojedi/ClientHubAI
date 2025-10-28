#!/usr/bin/env node

/**
 * Replit Storage Checker
 * 
 * Run this script IN REPLIT to check what documents are available
 * in the Object Storage before running the full download.
 * 
 * Usage in Replit: node check-replit-storage.mjs
 */

import { Client } from '@replit/object-storage';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { documents } from './shared/schema.js';

// Initialize storage client (will use default bucket in Replit)
const objectStorage = new Client();

// Initialize database connection
const sql = postgres(process.env.DATABASE_URL);
const db = drizzle(sql);

async function checkReplitStorage() {
  console.log('🔍 Checking Replit Object Storage...\n');
  
  try {
    // Test storage connectivity
    console.log('1️⃣ Testing storage connectivity...');
    const testKey = 'connectivity-test-' + Date.now();
    const testContent = 'test-content';
    
    const uploadResult = await objectStorage.uploadFromText(testKey, Buffer.from(testContent).toString('base64'));
    
    if (uploadResult.ok) {
      console.log('✅ Storage is writable');
      
      const downloadResult = await objectStorage.downloadAsText(testKey);
      if (downloadResult.ok) {
        const downloaded = Buffer.from(downloadResult.value, 'base64').toString();
        if (downloaded === testContent) {
          console.log('✅ Storage is readable');
        } else {
          console.log('❌ Downloaded content does not match');
        }
      } else {
        console.log('❌ Storage is not readable');
      }
    } else {
      console.log('❌ Storage is not writable:', uploadResult.error);
      return;
    }
    
    // Get documents from database
    console.log('\n2️⃣ Checking database documents...');
    const allDocs = await db.select().from(documents);
    console.log(`📊 Found ${allDocs.length} documents in database\n`);
    
    if (allDocs.length === 0) {
      console.log('No documents found in database.');
      return;
    }
    
    // Test a sample of documents
    console.log('3️⃣ Testing document availability...\n');
    
    let availableCount = 0;
    let unavailableCount = 0;
    const sampleSize = Math.min(20, allDocs.length);
    
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
        console.log(`❌ ${doc.id}: ${doc.originalName} - Error: ${error.message}`);
        unavailableCount++;
      }
    }
    
    console.log(`\n📈 Sample Results (${sampleSize} documents):`);
    console.log(`   Available: ${availableCount}`);
    console.log(`   Unavailable: ${unavailableCount}`);
    
    if (availableCount > 0) {
      console.log(`\n🎯 Documents are available in Replit Object Storage!`);
      console.log(`💡 You can run: node download-from-replit.mjs`);
      console.log(`💡 This will download all ${allDocs.length} documents`);
    } else {
      console.log(`\n⚠️  No documents found in storage.`);
      console.log(`💡 This could mean:`);
      console.log(`   - Documents were deleted from storage`);
      console.log(`   - Documents are stored with different keys`);
      console.log(`   - Database records exist but files are missing`);
    }
    
    // Try to list all objects in storage
    console.log('\n4️⃣ Attempting to list all objects...');
    try {
      const listResult = await objectStorage.list();
      if (listResult.ok) {
        console.log(`📄 Found ${listResult.value.length} total objects in storage`);
        
        if (listResult.value.length > 0) {
          console.log('\nFirst 10 objects:');
          listResult.value.slice(0, 10).forEach(obj => {
            console.log(`  - ${obj.key}`);
          });
          
          if (listResult.value.length > 10) {
            console.log(`  ... and ${listResult.value.length - 10} more`);
          }
        }
      } else {
        console.log('❌ Could not list objects:', listResult.error);
      }
    } catch (error) {
      console.log('❌ Error listing objects:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await sql.end();
  }
}

checkReplitStorage();
