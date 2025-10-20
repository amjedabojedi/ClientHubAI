import { Client } from '@replit/object-storage';

async function testDoc28() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  const key = 'documents/28-Updated consent';
  console.log('Testing document 28 download...');
  console.log('Key:', key);
  
  // Download as text (what our code does)
  const result = await objectStorage.downloadAsText(key);
  console.log('\nDownload result:', result.ok ? 'SUCCESS' : 'FAILED');
  
  if (result.ok) {
    console.log('Base64 length:', result.value.length, 'chars');
    
    // Decode to buffer
    const buffer = Buffer.from(result.value, 'base64');
    console.log('Decoded buffer size:', buffer.length, 'bytes');
    console.log('First 20 bytes:', buffer.toString('utf8', 0, 20));
    console.log('Is valid PDF?', buffer.toString('utf8', 0, 5) === '%PDF-' ? 'YES ✅' : 'NO ❌');
  } else {
    console.log('Error:', result.error);
  }
}

testDoc28().catch(console.error);
