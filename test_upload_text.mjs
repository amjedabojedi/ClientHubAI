import { Client } from '@replit/object-storage';

async function testUploadText() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  const testContent = "Hello World! Testing uploadFromText.";
  
  console.log('=== TEST: uploadFromText ===');
  console.log('Text content length:', testContent.length);
  
  const uploadResult = await objectStorage.uploadFromText('test-text', testContent);
  console.log('Upload result:', uploadResult.ok ? 'SUCCESS' : 'FAILED');
  
  const downloadResult = await objectStorage.downloadAsText('test-text');
  console.log('Download result:', downloadResult.ok ? 'SUCCESS' : 'FAILED');
  if (downloadResult.ok) {
    console.log('Downloaded length:', downloadResult.value.length);
    console.log('Downloaded text:', downloadResult.value);
    console.log('Match:', downloadResult.value === testContent ? 'YES' : 'NO');
  }
}

testUploadText().catch(console.error);
