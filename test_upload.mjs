import { Client } from '@replit/object-storage';

async function testUpload() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  // Create a test buffer
  const testContent = "Hello World! This is a test file with more content to make it bigger.";
  const buffer = Buffer.from(testContent, 'utf8');
  
  console.log('Test content:', testContent);
  console.log('Buffer size:', buffer.length, 'bytes');
  console.log('Buffer type:', buffer.constructor.name);
  
  // Upload
  const uploadResult = await objectStorage.uploadFromBytes('test-upload-1', buffer);
  console.log('Upload result:', uploadResult.ok ? 'SUCCESS' : 'FAILED');
  if (!uploadResult.ok) {
    console.log('Upload error:', uploadResult.error);
  }
  
  // Download to verify
  const downloadResult = await objectStorage.downloadAsBytes('test-upload-1');
  console.log('Download result:', downloadResult.ok ? 'SUCCESS' : 'FAILED');
  if (downloadResult.ok) {
    const downloaded = Buffer.from(downloadResult.value);
    console.log('Downloaded size:', downloaded.length, 'bytes');
    console.log('Downloaded content:', downloaded.toString('utf8'));
    console.log('Match:', downloaded.toString('utf8') === testContent ? 'YES' : 'NO');
  }
}

testUpload().catch(console.error);
