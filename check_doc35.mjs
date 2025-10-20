import { Client } from '@replit/object-storage';

async function checkDoc35() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  const key = 'documents/35-1760919575330-cbt.pdf';
  console.log('Checking document 35 (client-uploaded PDF)...');
  console.log('Key:', key);
  
  const result = await objectStorage.downloadAsText(key);
  console.log('\nDownload result:', result.ok ? 'SUCCESS' : 'FAILED');
  
  if (result.ok) {
    console.log('Base64 length:', result.value.length, 'chars');
    console.log('First 100 chars of base64:', result.value.substring(0, 100));
    
    // Check if it's valid base64
    const isValidBase64 = /^[A-Za-z0-9+/]+=*$/.test(result.value.substring(0, 100));
    console.log('Looks like valid base64?', isValidBase64 ? 'YES' : 'NO');
    
    // Try to decode
    try {
      const buffer = Buffer.from(result.value, 'base64');
      console.log('\nDecoded buffer size:', buffer.length, 'bytes');
      console.log('First 50 bytes (hex):', buffer.toString('hex', 0, 50));
      console.log('First 20 bytes (utf8):', buffer.toString('utf8', 0, 20));
      console.log('Is valid PDF?', buffer.toString('utf8', 0, 5) === '%PDF-' ? 'YES ✅' : 'NO ❌');
    } catch (error) {
      console.log('Decode error:', error.message);
    }
  }
}

checkDoc35().catch(console.error);
