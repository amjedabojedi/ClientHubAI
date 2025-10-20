const { Client } = require('@replit/object-storage');

async function checkDocument() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  // Check document 28
  const key28 = 'documents/28-1726016204259-Updated consent.pdf';
  const result28 = await objectStorage.downloadAsBytes(key28);
  
  console.log('Document 28:', {
    exists: result28.ok,
    size: result28.ok ? result28.value.length : 'N/A',
    key: key28
  });
  
  // Check if it starts with PDF magic bytes
  if (result28.ok) {
    const firstBytes = Buffer.from(result28.value).slice(0, 5).toString();
    console.log('First 5 bytes:', firstBytes);
    console.log('Is PDF?', firstBytes === '%PDF-');
  }
}

checkDocument().catch(console.error);
