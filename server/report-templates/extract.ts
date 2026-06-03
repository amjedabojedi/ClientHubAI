// Extracts a plain-text structural outline from an uploaded report template
// (Word .docx or PDF). The extracted text captures headings, section labels,
// and layout cues so the AI can mimic the template when generating a client
// report. Binary files are never persisted — only this text outline is stored.

export interface ExtractedTemplate {
  structureText: string;
}

const MAX_STRUCTURE_CHARS = 30000;

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_STRUCTURE_CHARS);
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  // Use raw text extraction to preserve the heading/section outline without
  // markup noise. mammoth keeps paragraph breaks as newlines.
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs v5 no longer accepts an empty workerSrc — it must point at a real,
  // importable worker module or the "fake worker" fallback throws. Resolve the
  // bundled legacy worker to a file:// URL so it loads in Node.
  if (pdfjs.GlobalWorkerOptions) {
    const moduleApi: any = await import('module');
    const { pathToFileURL } = await import('url');
    const require = moduleApi.createRequire(import.meta.url);
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
      .filter(Boolean);
    pages.push(strings.join(' '));
  }
  return pages.join('\n\n');
}

export async function extractTemplateStructure(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<ExtractedTemplate> {
  const name = (originalName || '').toLowerCase();
  const isDocx =
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx');
  const isPdf = mimeType === 'application/pdf' || name.endsWith('.pdf');

  let raw = '';
  if (isDocx) {
    raw = await extractDocx(buffer);
  } else if (isPdf) {
    raw = await extractPdf(buffer);
  } else {
    throw new Error(
      'Unsupported template format. Please upload a Word (.docx) or PDF (.pdf) file.',
    );
  }

  const structureText = normalizeWhitespace(raw);
  if (!structureText) {
    throw new Error(
      'Could not read any text from the uploaded template. Please ensure the file is not empty or image-only.',
    );
  }
  return { structureText };
}

// True when the file type is a supported supporting-document format
// (Word .docx, PDF, or plain text).
export function isSupportedDocumentType(mimeType: string, originalName: string): boolean {
  const name = (originalName || '').toLowerCase();
  return (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx') ||
    mimeType === 'application/pdf' ||
    name.endsWith('.pdf') ||
    mimeType === 'text/plain' ||
    name.endsWith('.txt')
  );
}

// Extracts plain text from a supporting document (Word .docx, PDF, or .txt) so
// it can be supplied to the AI as extra reference context for a client report.
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<string> {
  const name = (originalName || '').toLowerCase();
  const isDocx =
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx');
  const isPdf = mimeType === 'application/pdf' || name.endsWith('.pdf');
  const isTxt = mimeType === 'text/plain' || name.endsWith('.txt');

  let raw = '';
  if (isDocx) {
    raw = await extractDocx(buffer);
  } else if (isPdf) {
    raw = await extractPdf(buffer);
  } else if (isTxt) {
    raw = buffer.toString('utf-8');
  } else {
    throw new Error(
      'Unsupported file format. Please upload a Word (.docx), PDF (.pdf), or plain text (.txt) file.',
    );
  }

  const text = normalizeWhitespace(raw);
  if (!text) {
    throw new Error(
      'Could not read any text from the uploaded file. Please ensure it is not empty or image-only.',
    );
  }
  return text;
}
