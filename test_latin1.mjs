import { Client } from '@replit/object-storage';

async function testLatin1() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  const key = 'documents/35-1760919575330-cbt.pdf';
  const result = await objectStorage.downloadAsText(key);
  
  if (result.ok) {
    const content = result.value;
    console.log('Content length:', content.length);
    
    // Use latin1 encoding (correct for raw bytes)
    const buffer = Buffer.from(content, 'latin1');
    
    console.log('Buffer size:', buffer.length, 'bytes');
    console.log('First 20 bytes:', buffer.toString('utf8', 0, 20));
    console.log('Is valid PDF?', buffer.toString('utf8', 0, 5) === '%PDF-' ? 'YES ✅' : 'NO ❌');
    console.log('\nExpected size from DB: 12739584 bytes');
    console.log('Actual size:', buffer.length, 'bytes');
    console.log('Match:', buffer.length === 12092029 ? 'YES ✅' : 'NO ❌');
  }
}

testLatin1().catch(console.error);
