import { Client } from '@replit/object-storage';

async function testDoc35Serve() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  const key = 'documents/35-1760919575330-cbt.pdf';
  console.log('Testing document 35 serve logic...\n');
  
  const result = await objectStorage.downloadAsText(key);
  
  if (result.ok) {
    const content = result.value;
    console.log('Content length:', content.length);
    console.log('First 100 chars:', content.substring(0, 100));
    
    // Test the auto-detection logic
    const looksLikeBase64 = /^[A-Za-z0-9+/]+=*$/.test(content.substring(0, 100));
    console.log('\nAuto-detection says base64?', looksLikeBase64);
    
    let fileBuffer;
    if (looksLikeBase64) {
      console.log('→ Decoding as base64...');
      fileBuffer = Buffer.from(content, 'base64');
    } else {
      console.log('→ Using as raw UTF-8 bytes...');
      fileBuffer = Buffer.from(content, 'utf8');
    }
    
    console.log('\nResulting buffer size:', fileBuffer.length, 'bytes');
    console.log('First 20 bytes (hex):', fileBuffer.toString('hex', 0, 20));
    console.log('First 20 bytes (utf8):', fileBuffer.toString('utf8', 0, 20));
    console.log('Is valid PDF?', fileBuffer.toString('utf8', 0, 5) === '%PDF-' ? 'YES ✅' : 'NO ❌');
  }
}

testDoc35Serve().catch(console.error);
