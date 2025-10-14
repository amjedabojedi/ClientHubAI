import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

interface AssessmentAssignment {
  id: number;
  clientId: number;
  templateId: number;
  assignedById: number;
  completedAt?: Date | null;
  client?: {
    id: number;
    fullName: string;
    clientId?: string | null;
    dateOfBirth?: Date | null;
    gender?: string | null;
    phoneNumber?: string | null;
    emailAddress?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
  };
  template?: {
    name: string;
  };
  assignedBy?: {
    id: number;
    fullName: string;
    title?: string | null;
    signatureImage?: string | null;
    profile?: {
      licenseType?: string | null;
      licenseNumber?: string | null;
    } | null;
  };
}

interface AssessmentReport {
  id: number;
  assignmentId: number;
  generatedContent?: string | null;
  draftContent?: string | null;
  finalContent?: string | null;
  generatedAt?: Date | null;
  isDraft?: boolean;
  isFinalized?: boolean;
  finalizedAt?: Date | null;
  finalizedById?: number | null;
}

interface PracticeSettings {
  name: string;
  description?: string;
  subtitle?: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

export function generateAssessmentReportHTML(
  assignment: AssessmentAssignment,
  report: AssessmentReport,
  practiceSettings: PracticeSettings
): string {
  // Use EST timezone for all dates
  const PRACTICE_TIMEZONE = 'America/New_York';
  
  const completionDate = assignment.completedAt 
    ? formatInTimeZone(new Date(assignment.completedAt), PRACTICE_TIMEZONE, 'MMMM dd, yyyy')
    : 'Not completed';
    
  const reportGeneratedDate = report.generatedAt
    ? formatInTimeZone(new Date(report.generatedAt), PRACTICE_TIMEZONE, 'MMMM dd, yyyy')
    : formatInTimeZone(new Date(), PRACTICE_TIMEZONE, 'MMMM dd, yyyy');
    
  const finalizedDate = report.finalizedAt 
    ? formatInTimeZone(new Date(report.finalizedAt), PRACTICE_TIMEZONE, 'MMMM dd, yyyy')
    : null;

  const clientDOB = assignment.client?.dateOfBirth
    ? formatInTimeZone(new Date(assignment.client.dateOfBirth), PRACTICE_TIMEZONE, 'MMMM dd, yyyy')
    : 'Not provided';

  // Format client address
  let clientAddress = 'Not provided';
  if (assignment.client?.address) {
    const parts = [
      assignment.client.address,
      assignment.client.city,
      assignment.client.province,
      assignment.client.postalCode
    ].filter(Boolean);
    clientAddress = parts.join(', ');
  }

  // Process report content - prioritize finalContent if finalized (matching session notes pattern)
  let content = report.finalContent || report.draftContent || report.generatedContent || '';
  
  // Rich text HTML is already formatted from ReactQuill, but handle legacy markdown if needed
  if (content && !content.includes('<')) {
    // Handle markdown formatting for legacy content
    content = content
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/## ([^<]+)/g, '<h2 class="section-heading">$1</h2>')
      .replace(/# ([^<]+)/g, '<h1 class="main-heading">$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Wrap content in paragraphs if not already
    if (!content.startsWith('<')) {
      content = '<p>' + content;
    }
    if (!content.endsWith('>')) {
      content = content + '</p>';
    }
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: 'Helvetica', 'Arial', sans-serif;
          padding: 20px 30px;
          line-height: 1.6;
          color: #333;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #2563eb;
          padding-bottom: 12px;
          margin-bottom: 20px;
        }
        .header-left {
          flex: 1;
        }
        .header-right {
          text-align: right;
          color: #4b5563;
          font-size: 13px;
        }
        .practice-name {
          font-weight: 700;
          color: #1e40af;
          font-size: 18px;
          margin-bottom: 8px;
        }
        .practice-info {
          margin: 4px 0;
          font-size: 13px;
          color: #4b5563;
        }
        h1.report-title {
          color: #1e40af;
          margin: 20px 0 10px 0;
          font-size: 28px;
          text-align: center;
          letter-spacing: 1px;
        }
        .confidentiality-banner {
          background-color: #fef3c7;
          border-left: 4px solid #f59e0b;
          padding: 10px 15px;
          margin: 15px 0;
          text-align: center;
          font-size: 12px;
          font-weight: 600;
          color: #92400e;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .client-info-section {
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 20px;
          margin: 20px 0;
        }
        .client-info-title {
          font-size: 16px;
          font-weight: 700;
          color: #1e40af;
          margin-bottom: 15px;
          padding-bottom: 8px;
          border-bottom: 2px solid #dbeafe;
        }
        .info-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .info-item {
          margin: 0;
        }
        .info-label {
          font-weight: 600;
          color: #64748b;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 4px;
        }
        .info-value {
          font-size: 14px;
          color: #1f2937;
        }
        .report-content {
          margin: 25px 0;
        }
        .main-heading {
          color: #1e40af;
          font-size: 20px;
          margin: 25px 0 12px 0;
          padding-bottom: 6px;
          border-bottom: 2px solid #dbeafe;
        }
        .section-heading {
          color: #1e40af;
          font-size: 17px;
          font-weight: 700;
          margin: 20px 0 10px 0;
          padding-bottom: 4px;
          border-bottom: 1px solid #e0e7ff;
        }
        .report-content p {
          margin: 8px 0;
          line-height: 1.7;
          color: #374151;
        }
        .report-content strong {
          color: #1f2937;
          font-weight: 600;
        }
        .signature-section {
          margin-top: 40px;
          padding: 20px;
          border-top: 3px solid #2563eb;
          page-break-inside: avoid;
        }
        .signature-title {
          font-size: 14px;
          font-weight: 700;
          color: #1e40af;
          text-transform: uppercase;
          margin-bottom: 15px;
          letter-spacing: 0.5px;
        }
        .signature-content {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }
        .signature-image {
          max-width: 250px;
          max-height: 80px;
          margin-bottom: 10px;
          border-bottom: 2px solid #1e40af;
          padding-bottom: 5px;
        }
        .signature-details {
          margin-top: 8px;
        }
        .signature-name {
          font-weight: 700;
          font-size: 15px;
          color: #1f2937;
          margin-bottom: 4px;
        }
        .signature-title-text {
          font-size: 13px;
          color: #4b5563;
          margin-bottom: 2px;
        }
        .signature-date {
          font-size: 13px;
          color: #6b7280;
          margin-top: 8px;
          font-style: italic;
        }
        .footer {
          margin-top: 30px;
          padding-top: 15px;
          border-top: 1px solid #e5e7eb;
          text-align: center;
          font-size: 11px;
          color: #9ca3af;
        }
        @media print {
          body {
            padding: 15px 20px;
          }
          .signature-section {
            page-break-before: auto;
          }
        }
      </style>
    </head>
    <body>
      <!-- Practice Header -->
      <div class="header">
        <div class="header-left">
          <div class="practice-name">${practiceSettings.name}</div>
          <p class="practice-info">${practiceSettings.address.replace(/\n/g, '<br>')}</p>
          <p class="practice-info">Phone: ${practiceSettings.phone} | Email: ${practiceSettings.email}</p>
          <p class="practice-info">Website: ${practiceSettings.website}</p>
        </div>
        <div class="header-right">
          <div>Report Generated</div>
          <div style="font-weight: 600; color: #1f2937;">${reportGeneratedDate}</div>
        </div>
      </div>

      <!-- Report Title -->
      <h1 class="report-title">CLINICAL ASSESSMENT REPORT</h1>

      <!-- Confidentiality Banner -->
      <div class="confidentiality-banner">
        ⚠️ Confidential Medical Record - HIPAA Protected Information
      </div>

      <!-- Client Information Section -->
      <div class="client-info-section">
        <div class="client-info-title">CLIENT INFORMATION</div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Client Name</div>
            <div class="info-value">${assignment.client?.fullName || 'Not provided'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Client ID</div>
            <div class="info-value">${assignment.client?.clientId || 'Not provided'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Date of Birth</div>
            <div class="info-value">${clientDOB}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Gender</div>
            <div class="info-value">${assignment.client?.gender || 'Not specified'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Phone Number</div>
            <div class="info-value">${assignment.client?.phoneNumber || 'Not provided'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Email Address</div>
            <div class="info-value">${assignment.client?.emailAddress || 'Not provided'}</div>
          </div>
          <div class="info-item" style="grid-column: 1 / -1;">
            <div class="info-label">Address</div>
            <div class="info-value">${clientAddress}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Assessment</div>
            <div class="info-value">${assignment.template?.name || 'Assessment'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Completion Date</div>
            <div class="info-value">${completionDate}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Clinician</div>
            <div class="info-value">${assignment.assignedBy?.fullName || 'Not assigned'}${assignment.assignedBy?.title ? ', ' + assignment.assignedBy.title : ''}</div>
          </div>
        </div>
      </div>

      <!-- Report Content -->
      <div class="report-content">
        ${content}
      </div>

      <!-- Signature Section (only if finalized) -->
      ${report.isFinalized && finalizedDate && assignment.assignedBy ? `
        <div class="signature-section">
          <div class="signature-title">Digital Signature</div>
          <div class="signature-content">
            ${assignment.assignedBy.signatureImage ? `
              <img src="${assignment.assignedBy.signatureImage}" alt="Signature" class="signature-image" />
            ` : ''}
            <div class="signature-details">
              <div class="signature-name">${assignment.assignedBy.fullName}</div>
              ${assignment.assignedBy.profile?.licenseType ? `
                <div class="signature-title-text">${assignment.assignedBy.profile.licenseType}${assignment.assignedBy.profile.licenseNumber ? ' #' + assignment.assignedBy.profile.licenseNumber : ''}</div>
              ` : ''}
              <div class="signature-date">Digitally signed: ${finalizedDate}</div>
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Footer -->
      <div class="footer">
        <p>This report was generated electronically and is valid without a physical signature.</p>
        <p>${practiceSettings.name} | ${practiceSettings.phone} | ${practiceSettings.email}</p>
      </div>
    </body>
    </html>
  `;

  return html;
}
