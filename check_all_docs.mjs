import { Client } from '@replit/object-storage';

async function checkAllDocs() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  const docIds = [28, 35, 36];
  
  for (const id of docIds) {
    console.log(`\n=== Document ${id} ===`);
    
    // Try different key patterns
    const keys = [
      `documents/${id}-Updated consent`,
      `documents/${id}-1760919575330-cbt.pdf`,
      `documents/${id}-letter`,
    ];
    
    for (const key of keys) {
      const result = await objectStorage.downloadAsText(key);
      if (result.ok) {
        console.log(`✅ Key: ${key}`);
        console.log(`   Base64 length: ${result.value.length}`);
        const decoded = Buffer.from(result.value, 'base64');
        console.log(`   Decoded size: ${decoded.length} bytes`);
        console.log(`   First 10 chars: ${decoded.toString('utf8', 0, 10)}`);
        break;
      }
    }
  }
}

checkAllDocs().catch(console.error);
