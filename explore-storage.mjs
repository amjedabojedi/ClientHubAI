#!/usr/bin/env node

/**
 * Replit Storage Explorer Script
 * 
 * This script explores what's actually stored in Replit Object Storage
 * without relying on the database.
 */

import { Client } from '@replit/object-storage';

const REPLIT_BUCKET_ID = "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8";

async function exploreStorage() {
  console.log('🔍 Exploring Replit Object Storage...\n');
  
  try {
    // Initialize storage client
    const objectStorage = new Client({ bucketId: REPLIT_BUCKET_ID });
    console.log('✅ Connected to Replit Object Storage');
    
    // Test some known document patterns based on the codebase
    const testKeys = [
      'documents/28-Updated consent',
      'documents/28-1726016204259-Updated consent.pdf',
      'documents/35-letter',
      'documents/36-test',
      'documents/1297-test',
      'test-upload-1',
      'test-pdf-new',
      'test-buffer',
      'test-uint8',
      'test-array'
    ];
    
    console.log('🧪 Testing known document keys...\n');
    
    let foundCount = 0;
    const foundDocuments = [];
    
    for (const key of testKeys) {
      try {
        const result = await objectStorage.downloadAsText(key);
        
        if (result.ok) {
          const size = Buffer.from(result.value, 'base64').length;
          console.log(`✅ Found: ${key} (${size} bytes)`);
          foundDocuments.push({ key, size });
          foundCount++;
        } else {
          console.log(`❌ Not found: ${key}`);
        }
      } catch (error) {
        console.log(`❌ Error testing ${key}: ${error.message}`);
      }
    }
    
    console.log(`\n📈 Results:`);
    console.log(`   Found: ${foundCount} documents`);
    console.log(`   Total size: ${foundDocuments.reduce((sum, doc) => sum + doc.size, 0)} bytes`);
    
    if (foundCount > 0) {
      console.log('\n📄 Found documents:');
      foundDocuments.forEach(doc => {
        console.log(`  - ${doc.key}: ${doc.size} bytes`);
      });
      
      console.log('\n🎯 Documents are available in Replit Object Storage!');
      console.log('💡 The issue is that your local database is empty.');
      console.log('💡 You need to restore the data from your Neon backup.');
    } else {
      console.log('\n⚠️  No documents found in Replit Object Storage.');
      console.log('💡 This could mean:');
      console.log('   1. The storage bucket is empty');
      console.log('   2. The bucket ID has changed');
      console.log('   3. The documents were deleted');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

exploreStorage();
