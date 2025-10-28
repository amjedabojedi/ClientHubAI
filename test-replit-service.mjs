#!/usr/bin/env node

/**
 * Replit Service Test Script
 * 
 * This script tests if the Replit Object Storage service is working
 * and if there are any permissions or service issues.
 */

import { Client } from '@replit/object-storage';

async function testReplitService() {
  console.log('🧪 Testing Replit Object Storage Service...\n');
  
  try {
    // Test with the hardcoded bucket ID
    console.log('1️⃣ Testing with hardcoded bucket ID...');
    const bucket1 = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
    
    try {
      const testKey1 = 'test-' + Date.now();
      const testContent1 = 'test-content-' + Date.now();
      
      console.log(`   Uploading test file: ${testKey1}`);
      const upload1 = await bucket1.uploadFromText(testKey1, Buffer.from(testContent1).toString('base64'));
      
      if (upload1.ok) {
        console.log('   ✅ Upload successful');
        
        const download1 = await bucket1.downloadAsText(testKey1);
        if (download1.ok) {
          const downloaded1 = Buffer.from(download1.value, 'base64').toString();
          if (downloaded1 === testContent1) {
            console.log('   ✅ Download successful - content matches');
          } else {
            console.log('   ❌ Download successful but content does not match');
          }
        } else {
          console.log('   ❌ Download failed:', download1.error);
        }
      } else {
        console.log('   ❌ Upload failed:', upload1.error);
      }
    } catch (error) {
      console.log('   ❌ Error with hardcoded bucket:', error.message);
    }
    
    console.log('\n2️⃣ Testing with default bucket (from .replit)...');
    
    // Test with default bucket (no bucketId specified)
    const bucket2 = new Client();
    
    try {
      const testKey2 = 'test-default-' + Date.now();
      const testContent2 = 'test-default-content-' + Date.now();
      
      console.log(`   Uploading test file: ${testKey2}`);
      const upload2 = await bucket2.uploadFromText(testKey2, Buffer.from(testContent2).toString('base64'));
      
      if (upload2.ok) {
        console.log('   ✅ Upload successful');
        
        const download2 = await bucket2.downloadAsText(testKey2);
        if (download2.ok) {
          const downloaded2 = Buffer.from(download2.value, 'base64').toString();
          if (downloaded2 === testContent2) {
            console.log('   ✅ Download successful - content matches');
          } else {
            console.log('   ❌ Download successful but content does not match');
          }
        } else {
          console.log('   ❌ Download failed:', download2.error);
        }
      } else {
        console.log('   ❌ Upload failed:', upload2.error);
      }
    } catch (error) {
      console.log('   ❌ Error with default bucket:', error.message);
    }
    
    console.log('\n3️⃣ Testing bucket listing (if supported)...');
    
    try {
      // Try to list objects in the bucket
      const listResult = await bucket1.list();
      if (listResult.ok) {
        console.log(`   ✅ Bucket listing successful - found ${listResult.value.length} objects`);
        if (listResult.value.length > 0) {
          console.log('   📄 Objects in bucket:');
          listResult.value.slice(0, 10).forEach(obj => {
            console.log(`     - ${obj.key}`);
          });
          if (listResult.value.length > 10) {
            console.log(`     ... and ${listResult.value.length - 10} more`);
          }
        }
      } else {
        console.log('   ❌ Bucket listing failed:', listResult.error);
      }
    } catch (error) {
      console.log('   ❌ Error listing bucket:', error.message);
    }
    
    console.log('\n📊 Summary:');
    console.log('   - If uploads/downloads work: Replit Object Storage service is functional');
    console.log('   - If uploads/downloads fail: Service may be disabled or bucket deleted');
    console.log('   - If listing works: You can see what files exist');
    console.log('   - If listing fails: Service may not support listing or bucket is empty');
    
  } catch (error) {
    console.error('❌ Critical error:', error);
  }
}

testReplitService();
