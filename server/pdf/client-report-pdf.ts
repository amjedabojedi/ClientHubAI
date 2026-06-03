import { formatInTimeZone } from 'date-fns-tz';
import fs from 'fs';
import puppeteer from 'puppeteer';

const PRACTICE_TIMEZONE = 'America/New_York';

function getChromiumExecutablePath(): string | undefined {
  const nixPath = '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
  if (fs.existsSync(nixPath)) {
    return nixPath;
  }
  // Return undefined to let Puppeteer find system-installed Chrome/Chromium automatically
  return undefined;
}

async function renderReportPDF(html: string, launchOptions: any): Promise<Buffer> {
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setDefaultTimeout(60000);
    await page.setViewport({ width: 1200, height: 800 });
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Allow fonts and styling to settle before rendering
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '10mm', bottom: '20mm', left: '10mm' },
      timeout: 60000,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/**
 * Render arbitrary print-ready HTML to a real PDF buffer using headless Chromium.
 *
 * If the first attempt fails because Chromium times out or cannot launch, this
 * retries once with lighter launch args (mirroring the invoice-email PDF path).
 * Shared by the client report, assessment report, and form assignment PDF routes.
 */
export async function generatePDFFromHTML(html: string): Promise<Buffer> {
  const chromiumPath = getChromiumExecutablePath();
  const launchOptions: any = {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-default-apps',
      '--single-process',
      '--no-zygote',
      '--disable-logging',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI,BlinkGenPropertyTrees',
    ],
    headless: true,
    timeout: 90000,
    protocolTimeout: 120000,
  };
  if (chromiumPath) {
    launchOptions.executablePath = chromiumPath;
  }

  try {
    return await renderReportPDF(html, launchOptions);
  } catch (error: any) {
    const message: string = error?.message || '';
    const isTimeout = message.includes('timeout') || message.includes('timed out');
    const isLaunchFailure =
      message.includes('Failed to launch') ||
      message.includes('spawn') ||
      message.includes('Target closed') ||
      message.includes('Protocol error');

    if (!isTimeout && !isLaunchFailure) {
      throw error;
    }

    console.error('Client report PDF generation failed, retrying with lighter args:', {
      error: message,
      errorType: error?.name || 'Unknown',
    });

    const retryLaunchOptions: any = {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true,
      timeout: 60000,
      protocolTimeout: 60000,
    };
    if (chromiumPath) {
      retryLaunchOptions.executablePath = chromiumPath;
    }

    return await renderReportPDF(html, retryLaunchOptions);
  }
}

/**
 * Render the client report HTML to a real PDF file buffer using headless Chromium.
 * Thin wrapper retained for backwards compatibility; see {@link generatePDFFromHTML}.
 */
export async function generateClientReportPDF(html: string): Promise<Buffer> {
  return generatePDFFromHTML(html);
}

interface ClientReportClient {
  fullName: string;
  clientId?: string | null;
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  phoneNumber?: string | null;
  emailAddress?: string | null;
}

interface ClientReportData {
  id: number;
  templateName?: string | null;
  generatedContent?: string | null;
  draftContent?: string | null;
  finalContent?: string | null;
  generatedAt?: Date | string | null;
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

export function generateClientReportHTML(
  client: ClientReportClient,
  report: ClientReportData,
  practiceSettings: PracticeSettings,
): string {
  const fmt = (d: Date | string | null | undefined) =>
    d ? formatInTimeZone(new Date(d), PRACTICE_TIMEZONE, 'MMMM dd, yyyy') : null;

  const clientDOB = fmt(client.dateOfBirth) || 'Not provided';
  const reportGeneratedDate =
    fmt(report.generatedAt) ||
    formatInTimeZone(new Date(), PRACTICE_TIMEZONE, 'MMMM dd, yyyy');
  const finalizedDate = fmt(report.finalizedAt);

  let content = report.finalContent || report.draftContent || report.generatedContent || '';
  if (content && !content.includes('<')) {
    content = content
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/## ([^<]+)/g, '<h2>$1</h2>')
      .replace(/# ([^<]+)/g, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
    if (!content.startsWith('<')) content = '<p>' + content;
    if (!content.endsWith('>')) content = content + '</p>';
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Helvetica', 'Arial', sans-serif; padding: 20px 30px; line-height: 1.5; color: #333; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2563eb; padding-bottom: 12px; margin-bottom: 15px; }
        .header-left { flex: 1; }
        .header-left h1 { color: #1e40af; font-size: 22px; margin: 0 0 4px 0; }
        .header-right { text-align: right; color: #4b5563; font-size: 13px; }
        .practice-name { font-weight: 600; color: #1e40af; font-size: 16px; margin-bottom: 8px; }
        .status-badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-left: 8px; vertical-align: middle; background: #dcfce7; color: #166534; }
        .confidentiality-banner { background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px 15px; margin: 12px 0; text-align: center; font-size: 12px; font-weight: 600; color: #92400e; letter-spacing: 0.5px; text-transform: uppercase; }
        .client-info-section { background-color: #f3f4f6; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 15px; margin: 12px 0 15px 0; }
        .client-info-title { font-size: 16px; font-weight: 700; color: #1e40af; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #dbeafe; }
        .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
        .info-label { font-weight: 600; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
        .info-value { font-size: 14px; color: #1f2937; }
        .report-content { margin-top: 8px; font-size: 14px; line-height: 1.6; }
        .report-content h1 { color: #1e40af; font-size: 19px; margin: 20px 0 8px 0; font-weight: 700; border-bottom: 2px solid #dbeafe; padding-bottom: 5px; }
        .report-content h2 { color: #1e40af; font-size: 17px; margin: 15px 0 6px 0; font-weight: 700; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
        .report-content h3 { color: #2563eb; font-size: 15px; margin: 10px 0 5px 0; font-weight: 600; }
        .report-content h4 { color: #3b82f6; font-size: 14px; margin: 8px 0 4px 0; font-weight: 600; }
        .report-content p { margin: 5px 0; line-height: 1.6; color: #374151; word-wrap: break-word; }
        .report-content strong { color: #1f2937; font-weight: 600; }
        .report-content ul, .report-content ol { margin: 5px 0 5px 20px; padding: 0; }
        .report-content li { margin: 3px 0; color: #374151; }
        .signature-section { margin-top: 30px; padding: 15px 20px; border-top: 2px solid #2563eb; background-color: #f9fafb; page-break-inside: avoid; }
        .signature-name { font-weight: 600; color: #1f2937; font-size: 15px; margin-bottom: 2px; }
        .signature-title { color: #6b7280; font-size: 13px; margin-bottom: 4px; }
        .signature-date { color: #9ca3af; font-size: 12px; font-style: italic; }
        .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 11px; color: #9ca3af; }
        @media print { body { padding: 15px 20px; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-left">
          <h1>${report.templateName || 'Client Report'}${report.isFinalized ? '<span class="status-badge">Finalized</span>' : ''}</h1>
          <p style="margin: 5px 0; color: #6b7280;">${client.fullName || 'Client'}</p>
        </div>
        <div class="header-right">
          <div class="practice-name">${practiceSettings.name}</div>
          <p style="margin: 4px 0;">${(practiceSettings.address || '').replace(/\n/g, '<br>')}</p>
          <p style="margin: 4px 0;">Phone: ${practiceSettings.phone}</p>
          <p style="margin: 4px 0;">Email: ${practiceSettings.email}</p>
          <p style="margin: 4px 0;">Website: ${practiceSettings.website}</p>
        </div>
      </div>

      <div class="confidentiality-banner">
        ⚠️ PERSONAL AND CONFIDENTIAL – Protected Health Information. Unauthorized use or disclosure is prohibited under HIPAA.
      </div>

      <div class="client-info-section">
        <div class="client-info-title">CLIENT INFORMATION</div>
        <div class="info-grid">
          <div class="info-item"><div class="info-label">Client Name</div><div class="info-value">${client.fullName || 'Not provided'}</div></div>
          <div class="info-item"><div class="info-label">Client ID</div><div class="info-value">${client.clientId || 'Not provided'}</div></div>
          <div class="info-item"><div class="info-label">Date of Birth</div><div class="info-value">${clientDOB}</div></div>
          <div class="info-item"><div class="info-label">Gender</div><div class="info-value">${client.gender || 'Not specified'}</div></div>
          <div class="info-item"><div class="info-label">Report Type</div><div class="info-value">${report.templateName || 'Client Report'}</div></div>
          <div class="info-item"><div class="info-label">Generated</div><div class="info-value">${reportGeneratedDate}</div></div>
          <div class="info-item"><div class="info-label">Prepared By</div><div class="info-value">${report.createdBy?.fullName || 'Not provided'}${report.createdBy?.title ? ', ' + report.createdBy.title : ''}</div></div>
        </div>
      </div>

      <div class="report-content">
        ${content}
      </div>

      ${report.isFinalized && finalizedDate ? `
        <div class="signature-section">
          <div class="signature-name">${report.createdBy?.fullName || ''}</div>
          ${report.createdBy?.title ? `<div class="signature-title">${report.createdBy.title}</div>` : ''}
          <div class="signature-date">Finalized on ${finalizedDate}</div>
        </div>
      ` : ''}

      <div class="footer">
        <p>${practiceSettings.name} | ${practiceSettings.phone} | ${practiceSettings.email}</p>
      </div>
    </body>
    </html>
  `;
}
