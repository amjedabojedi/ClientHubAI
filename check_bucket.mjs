import { Client } from '@replit/object-storage';

async function checkBucket() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  console.log('\n=== CHECKING DOCUMENT 28 ===');
  const key28 = 'documents/28-Updated consent';
  const result28 = await objectStorage.downloadAsBytes(key28);
  console.log('Key:', key28);
  console.log('Exists:', result28.ok);
  if (result28.ok) {
    const bytes = Buffer.from(result28.value);
    console.log('Size:', bytes.length, 'bytes');
    console.log('First 50 chars:', bytes.toString('utf8', 0, 50));
  }
  
  console.log('\n=== CHECKING DOCUMENT 35 ===');
  const key35 = 'documents/35-1760919575330-cbt.pdf';
  const result35 = await objectStorage.downloadAsBytes(key35);
  console.log('Key:', key35);
  console.log('Exists:', result35.ok);
  if (result35.ok) {
    const bytes = Buffer.from(result35.value);
    console.log('Size:', bytes.length, 'bytes');
    console.log('First 10 chars:', bytes.toString('utf8', 0, 10));
    console.log('Starts with %PDF-?', bytes.toString('utf8', 0, 5) === '%PDF-');
  }
}

checkBucket().catch(console.error);
