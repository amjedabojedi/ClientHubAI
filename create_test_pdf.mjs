// Create a minimal valid PDF for testing
const fs = require('fs');

const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 48 Tf
100 700 Td
(Test PDF) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000262 00000 n 
0000000355 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
434
%%EOF`;

// Write to file
fs.writeFileSync('test.pdf', pdfContent);
console.log('Created test.pdf');

// Convert to base64
const base64 = Buffer.from(pdfContent).toString('base64');
console.log('\nBase64 length:', base64.length);
console.log('File size:', pdfContent.length, 'bytes');
console.log('\nBase64 content:');
console.log(base64);
