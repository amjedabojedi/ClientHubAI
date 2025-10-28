#!/usr/bin/env node

/**
 * Comprehensive Replit Storage Check Script
 * 
 * This script thoroughly checks the Replit Object Storage bucket
 * to see if any data still exists with various naming patterns.
 */

import { Client } from '@replit/object-storage';

const REPLIT_BUCKET_ID = "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8";

async function comprehensiveStorageCheck() {
  console.log('🔍 Comprehensive Replit Object Storage Check...\n');
  
  try {
    // Initialize storage client
    const objectStorage = new Client({ bucketId: REPLIT_BUCKET_ID });
    console.log('✅ Connected to Replit Object Storage');
    console.log(`📦 Bucket ID: ${REPLIT_BUCKET_ID}\n`);
    
    // Test various document ID ranges and patterns
    const testPatterns = [];
    
    // Test document IDs from 1 to 1000 (common range)
    for (let i = 1; i <= 1000; i += 50) {
      testPatterns.push(`documents/${i}-test.pdf`);
      testPatterns.push(`documents/${i}-document.pdf`);
      testPatterns.push(`documents/${i}-file.pdf`);
      testPatterns.push(`documents/${i}-Updated consent.pdf`);
      testPatterns.push(`documents/${i}-letter.pdf`);
      testPatterns.push(`documents/${i}-form.pdf`);
    }
    
    // Test some specific patterns from the error logs
    testPatterns.push('documents/1297-test.pdf');
    testPatterns.push('documents/1297-document.pdf');
    testPatterns.push('documents/3803-test.pdf');
    testPatterns.push('documents/3803-document.pdf');
    
    // Test root level files
    testPatterns.push('test.pdf');
    testPatterns.push('document.pdf');
    testPatterns.push('file.pdf');
    
    // Test other common patterns
    testPatterns.push('uploads/test.pdf');
    testPatterns.push('files/test.pdf');
    testPatterns.push('data/test.pdf');
    
    console.log(`🧪 Testing ${testPatterns.length} different patterns...\n`);
    
    let foundCount = 0;
    const foundDocuments = [];
    
    // Test in batches to avoid overwhelming the service
    const batchSize = 20;
    for (let i = 0; i < testPatterns.length; i += batchSize) {
      const batch = testPatterns.slice(i, i + batchSize);
      
      console.log(`Testing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(testPatterns.length/batchSize)}...`);
      
      for (const key of batch) {
        try {
          const result = await objectStorage.downloadAsText(key);
          
          if (result.ok) {
            const size = Buffer.from(result.value, 'base64').length;
            console.log(`✅ FOUND: ${key} (${size} bytes)`);
            foundDocuments.push({ key, size });
            foundCount++;
          }
        } catch (error) {
          // Silently continue - most keys won't exist
        }
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n📈 Comprehensive Check Results:`);
    console.log(`   Total patterns tested: ${testPatterns.length}`);
    console.log(`   Documents found: ${foundCount}`);
    console.log(`   Total size: ${foundDocuments.reduce((sum, doc) => sum + doc.size, 0)} bytes`);
    
    if (foundCount > 0) {
      console.log('\n📄 Found documents:');
      foundDocuments.forEach(doc => {
        console.log(`  - ${doc.key}: ${doc.size} bytes`);
      });
      
      console.log('\n🎯 Data still exists in Replit Object Storage!');
      console.log('💡 You can proceed with the migration script.');
    } else {
      console.log('\n❌ NO DATA FOUND in Replit Object Storage');
      console.log('💡 This confirms that:');
      console.log('   1. The storage bucket is completely empty');
      console.log('   2. All documents have been deleted or never existed');
      console.log('   3. The bucket ID might be incorrect');
      console.log('   4. You may have been using a different storage system');
      
      console.log('\n🔍 Possible explanations:');
      console.log('   - Documents were deleted from Replit Object Storage');
      console.log('   - The application was using a different bucket ID');
      console.log('   - Documents were stored in a different location');
      console.log('   - The storage service was reset or cleared');
    }
    
    // Test bucket connectivity with a simple upload/download
    console.log('\n🧪 Testing bucket connectivity...');
    try {
      const testContent = 'test-connectivity-check';
      const testKey = 'connectivity-test-' + Date.now();
      
      const uploadResult = await objectStorage.uploadFromText(testKey, Buffer.from(testContent).toString('base64'));
      
      if (uploadResult.ok) {
        console.log('✅ Bucket is writable');
        
        const downloadResult = await objectStorage.downloadAsText(testKey);
        if (downloadResult.ok) {
          const downloaded = Buffer.from(downloadResult.value, 'base64').toString();
          if (downloaded === testContent) {
            console.log('✅ Bucket is readable');
            console.log('✅ Storage service is fully functional');
          } else {
            console.log('❌ Downloaded content does not match uploaded content');
          }
        } else {
          console.log('❌ Bucket is not readable');
        }
      } else {
        console.log('❌ Bucket is not writable');
        console.log(`   Error: ${uploadResult.error}`);
      }
    } catch (error) {
      console.log('❌ Bucket connectivity test failed:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

comprehensiveStorageCheck();
