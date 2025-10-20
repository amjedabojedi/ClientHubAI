import { Client } from '@replit/object-storage';

async function compare() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  console.log('=== DOCUMENT 28 (WORKING) ===');
  const doc28 = await objectStorage.downloadAsText('documents/28-Updated consent');
  if (doc28.ok) {
    const content28 = doc28.value;
    console.log('Content length:', content28.length);
    console.log('First 100 chars:', content28.substring(0, 100));
    console.log('Looks like base64?', /^[A-Za-z0-9+/]+=*$/.test(content28.substring(0, 100)));
    
    const decoded28 = Buffer.from(content28, 'base64');
    console.log('Decoded size:', decoded28.length);
    console.log('Is PDF?', decoded28.toString('utf8', 0, 5) === '%PDF-');
  }
  
  console.log('\n=== DOCUMENT 35 (NOT WORKING) ===');
  const doc35 = await objectStorage.downloadAsText('documents/35-1760919575330-cbt.pdf');
  if (doc35.ok) {
    const content35 = doc35.value;
    console.log('Content length:', content35.length);
    console.log('First 100 chars:', content35.substring(0, 100));
    console.log('Looks like base64?', /^[A-Za-z0-9+/]+=*$/.test(content35.substring(0, 100)));
  }
  
  console.log('\n=== WHAT SHOULD WE DO? ===');
  console.log('Document 28 approach: Store as base64, download as base64, decode to send');
  console.log('This is the WORKING approach we should use for ALL documents');
}

compare().catch(console.error);
