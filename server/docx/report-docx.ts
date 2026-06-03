import { formatInTimeZone } from 'date-fns-tz';

const PRACTICE_TIMEZONE = 'America/New_York';

interface ClientReportClient {
  fullName: string;
  clientId?: string | null;
  dateOfBirth?: Date | string | null;
}

interface ClientReportData {
  templateName?: string | null;
  generatedContent?: string | null;
  draftContent?: string | null;
  finalContent?: string | null;
  isFinalized?: boolean;
  finalizedAt?: Date | string | null;
  createdBy?: { fullName?: string | null; title?: string | null } | null;
}

interface PracticeSettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

export async function generateClientReportDocx(
  client: ClientReportClient,
  report: ClientReportData,
  practiceSettings: PracticeSettings,
): Promise<Buffer> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } =
    await import('docx');

  const reportContent =
    report.finalContent || report.draftContent || report.generatedContent || '';
  const paragraphs: any[] = [];

  // Practice header
  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: practiceSettings.name, bold: true, size: 28, color: '1e40af' })],
      spacing: { after: 100 },
    }),
  );
  if (practiceSettings.address) {
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: practiceSettings.address, size: 20 })],
        spacing: { after: 50 },
      }),
    );
  }
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({ text: `Phone: ${practiceSettings.phone} | Email: ${practiceSettings.email}`, size: 20 }),
      ],
      spacing: { after: 300 },
    }),
  );

  // Title
  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: (report.templateName || 'CLIENT REPORT').toUpperCase(), bold: true, size: 32, color: '1e40af' })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );

  // Confidentiality banner
  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: 'Confidential Medical Record - HIPAA Protected Information', bold: true, size: 20, color: '92400e' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      border: { left: { style: BorderStyle.SINGLE, size: 20, color: 'f59e0b' } },
    }),
  );

  // Client information
  paragraphs.push(
    new Paragraph({
      children: [new TextRun({ text: 'CLIENT INFORMATION', bold: true, size: 24, color: '1e40af' })],
      spacing: { after: 200 },
    }),
  );
  const clientInfo = [
    `Client Name: ${client.fullName || 'Not provided'}`,
    `Client ID: ${client.clientId || 'Not provided'}`,
    `Date of Birth: ${client.dateOfBirth ? formatInTimeZone(new Date(client.dateOfBirth), PRACTICE_TIMEZONE, 'MMMM dd, yyyy') : 'Not provided'}`,
    `Report Type: ${report.templateName || 'Client Report'}`,
    `Prepared By: ${report.createdBy?.fullName || 'Not provided'}${report.createdBy?.title ? ', ' + report.createdBy.title : ''}`,
  ];
  clientInfo.forEach((info) => {
    paragraphs.push(
      new Paragraph({ children: [new TextRun({ text: info, size: 22 })], spacing: { after: 100 } }),
    );
  });
  paragraphs.push(new Paragraph({ text: '', spacing: { after: 300 } }));

  // ---- HTML content parsing (headings, bold/italic/underline, lists, blockquotes) ----
  const decodeEntities = (s: string) =>
    s
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  const parseInline = (html: string): any[] => {
    const runs: any[] = [];
    const tokens = html.split(/(<\/?(?:strong|b|em|i|u|br\s*\/?)>)/gi);
    let bold = false;
    let italics = false;
    let underline = false;
    for (const tok of tokens) {
      if (!tok) continue;
      const m = tok.match(/^<(\/?)(strong|b|em|i|u|br)\s*\/?>$/i);
      if (m) {
        const close = m[1] === '/';
        const tag = m[2].toLowerCase();
        if (tag === 'br') {
          runs.push(new TextRun({ text: '', break: 1, font: 'Times New Roman', size: 22 }));
        } else if (tag === 'strong' || tag === 'b') {
          bold = !close;
        } else if (tag === 'em' || tag === 'i') {
          italics = !close;
        } else if (tag === 'u') {
          underline = !close;
        }
        continue;
      }
      const text = decodeEntities(tok.replace(/<[^>]+>/g, ''));
      if (!text) continue;
      runs.push(
        new TextRun({
          text,
          font: 'Times New Roman',
          size: 22,
          bold: bold || undefined,
          italics: italics || undefined,
          underline: underline ? {} : undefined,
        }),
      );
    }
    return runs.length ? runs : [new TextRun({ text: '', font: 'Times New Roman', size: 22 })];
  };

  const blockRegex = /<(h[1-4]|p|ul|ol|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks: { tag: string; inner: string }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(reportContent)) !== null) {
    if (match.index > lastIndex) {
      const between = reportContent.slice(lastIndex, match.index).trim();
      if (between) blocks.push({ tag: 'p', inner: between });
    }
    blocks.push({ tag: match[1].toLowerCase(), inner: match[2] });
    lastIndex = blockRegex.lastIndex;
  }
  if (lastIndex < reportContent.length) {
    const tail = reportContent.slice(lastIndex).trim();
    if (tail) blocks.push({ tag: 'p', inner: tail });
  }
  if (blocks.length === 0 && reportContent.trim()) {
    for (const line of reportContent.split(/\n+/)) {
      if (line.trim()) blocks.push({ tag: 'p', inner: line });
    }
  }

  const HEADING_SIZES: Record<string, number> = { h1: 32, h2: 28, h3: 26, h4: 24 };
  for (const { tag, inner } of blocks) {
    if (tag.startsWith('h')) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: decodeEntities(inner.replace(/<[^>]+>/g, '')).trim(),
              bold: true,
              size: HEADING_SIZES[tag] || 24,
              color: '1e40af',
              font: 'Times New Roman',
            }),
          ],
          heading:
            tag === 'h1'
              ? HeadingLevel.HEADING_1
              : tag === 'h2'
                ? HeadingLevel.HEADING_2
                : tag === 'h3'
                  ? HeadingLevel.HEADING_3
                  : HeadingLevel.HEADING_4,
          spacing: { before: 200, after: 120 },
        }),
      );
    } else if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi));
      items.forEach((li, idx) => {
        const prefix = tag === 'ol' ? `${idx + 1}. ` : '• ';
        const itemRuns = parseInline(li[1]);
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: prefix, font: 'Times New Roman', size: 22 }), ...itemRuns],
            indent: { left: 360 },
            spacing: { after: 80 },
          }),
        );
      });
    } else if (tag === 'blockquote') {
      paragraphs.push(
        new Paragraph({
          children: parseInline(inner),
          indent: { left: 720 },
          spacing: { after: 120 },
          alignment: AlignmentType.JUSTIFIED,
        }),
      );
    } else {
      const runs = parseInline(inner);
      const hasText = runs.some((r) => (r as any).options?.text?.trim?.());
      paragraphs.push(
        new Paragraph({
          children: runs,
          spacing: { after: hasText ? 120 : 80 },
          alignment: AlignmentType.JUSTIFIED,
        }),
      );
    }
  }

  // Signature (finalized only)
  if (report.isFinalized && report.finalizedAt) {
    paragraphs.push(new Paragraph({ text: '', spacing: { after: 400 } }));
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: report.createdBy?.fullName || '', bold: true, size: 24 })],
        spacing: { after: 100 },
      }),
    );
    if (report.createdBy?.title) {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: report.createdBy.title, size: 22 })],
          spacing: { after: 100 },
        }),
      );
    }
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Finalized: ${formatInTimeZone(new Date(report.finalizedAt), PRACTICE_TIMEZONE, 'MMMM dd, yyyy')}`,
            size: 22,
            italics: true,
          }),
        ],
        spacing: { after: 200 },
      }),
    );
  }

  // Footer
  paragraphs.push(new Paragraph({ text: '', spacing: { after: 400 } }));
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({ text: `${practiceSettings.name} | ${practiceSettings.phone} | ${practiceSettings.email}`, size: 20, color: '9ca3af' }),
      ],
      alignment: AlignmentType.CENTER,
    }),
  );

  const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
  return Packer.toBuffer(doc);
}
