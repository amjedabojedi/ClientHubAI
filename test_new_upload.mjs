import { Client } from '@replit/object-storage';

async function testNewSystem() {
  const objectStorage = new Client({ bucketId: "replit-objstore-b4f2317b-97e0-4b3a-913b-637fe3bbfea8" });
  
  // Create test base64 content (small PDF-like structure)
  const testBase64 = "JVBERi0xLjQKJeLjz9MKMyAwIG9iago8PC9UeXBlIC9QYWdlCi9QYXJlbnQgMSAwIFIKL01lZGlhQm94IFswIDAgNjEyIDc5Ml0KL0NvbnRlbnRzIDQgMCBSCi9SZXNvdXJjZXMgPDwvRm9udCA8PC9GMSA1IDAgUj4+Pj4KPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDQ0Pj4Kc3RyZWFtCkJUCi9GMSA0OCBUZgoxMCA3MDAgVGQKKEhlbGxvIFdvcmxkKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCjEgMCBvYmoKPDwvVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWzMgMCBSXQo+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlIC9DYXRhbG9nCi9QYWdlcyAxIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PC9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL1RpbWVzLVJvbWFuCj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAyNjIgMDAwMDAgbiAKMDAwMDAwMDMxOSAwMDAwMCBuIAowMDAwMDAwMDIyIDAwMDAwIG4gCjAwMDAwMDAxMzggMDAwMDAgbiAKMDAwMDAwMDM2OCAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNgovUm9vdCAyIDAgUgo+PgpzdGFydHhyZWYKNDYxCiUlRU9GCg==";
  
  console.log('=== TESTING NEW UPLOAD/DOWNLOAD SYSTEM ===');
  console.log('Base64 length:', testBase64.length);
  
  // Test upload using uploadFromText (our fix)
  const uploadResult = await objectStorage.uploadFromText('test-pdf-new', testBase64);
  console.log('Upload result:', uploadResult.ok ? 'SUCCESS' : 'FAILED');
  
  // Test download using downloadAsText (our fix)
  const downloadResult = await objectStorage.downloadAsText('test-pdf-new');
  console.log('Download result:', downloadResult.ok ? 'SUCCESS' : 'FAILED');
  
  if (downloadResult.ok) {
    console.log('Downloaded base64 length:', downloadResult.value.length);
    console.log('Match:', downloadResult.value === testBase64 ? 'YES ✅' : 'NO ❌');
    
    // Test decoding
    const buffer = Buffer.from(downloadResult.value, 'base64');
    console.log('Decoded buffer size:', buffer.length, 'bytes');
    console.log('Starts with %PDF-:', buffer.toString('utf8', 0, 5) === '%PDF-' ? 'YES ✅' : 'NO ❌');
  }
}

testNewSystem().catch(console.error);
