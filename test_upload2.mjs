import { Client } from '@replit/object-storage';

async function testUpload() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  const testContent = "Hello World! Testing Uint8Array upload method.";
  
  // Test 1: Regular Buffer
  const buffer = Buffer.from(testContent, 'utf8');
  console.log('\n=== TEST 1: Buffer ===');
  console.log('Buffer size:', buffer.length);
  const upload1 = await objectStorage.uploadFromBytes('test-buffer', buffer);
  console.log('Upload result:', upload1.ok ? 'SUCCESS' : 'FAILED');
  const download1 = await objectStorage.downloadAsBytes('test-buffer');
  if (download1.ok) {
    console.log('Downloaded size:', Buffer.from(download1.value).length, 'bytes');
  }
  
  // Test 2: Uint8Array
  const uint8 = new Uint8Array(buffer);
  console.log('\n=== TEST 2: Uint8Array ===');
  console.log('Uint8Array size:', uint8.length);
  const upload2 = await objectStorage.uploadFromBytes('test-uint8', uint8);
  console.log('Upload result:', upload2.ok ? 'SUCCESS' : 'FAILED');
  const download2 = await objectStorage.downloadAsBytes('test-uint8');
  if (download2.ok) {
    console.log('Downloaded size:', Buffer.from(download2.value).length, 'bytes');
  }
  
  // Test 3: Array.from(Buffer)
  const arr = Array.from(buffer);
  console.log('\n=== TEST 3: Array ===');
  console.log('Array size:', arr.length);
  const upload3 = await objectStorage.uploadFromBytes('test-array', arr);
  console.log('Upload result:', upload3.ok ? 'SUCCESS' : 'FAILED');
  const download3 = await objectStorage.downloadAsBytes('test-array');
  if (download3.ok) {
    console.log('Downloaded size:', Buffer.from(download3.value).length, 'bytes');
  }
}

testUpload().catch(console.error);
