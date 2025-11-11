import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { sanitizeHtml } from '../lib/sanitize';

// HTML escape function to prevent XSS attacks
function escapeHtml(unsafe: string | null | undefined): string {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Validate signature data URL to prevent XSS attacks
function isValidSignatureDataUrl(dataUrl: string | null | undefined): boolean {
  if (!dataUrl) return false;
  // Only allow PNG images with base64 encoding
  return dataUrl.startsWith('data:image/png;base64,');
}

// Format field response based on field type for PDF rendering
function formatFieldResponse(
  field: FormField,
  responseMap: Map<number, string>,
  assignment: FormAssignment
): string {
  const rawValue = responseMap.get(field.id);
  
  // Handle checkbox_group: render as bullet list
  if (field.fieldType === 'checkbox_group') {
    if (!rawValue || rawValue.trim() === '') {
      return '—';
    }
    const options = rawValue.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
    if (options.length === 0) {
      return '—';
    }
    const listItems = options.map(opt => `<li>${escapeHtml(opt)}</li>`).join('');
    return `<ul style="margin: 0; padding-left: 20px; list-style-type: disc;">${listItems}</ul>`;
  }
  
  // Handle fill_in_blank: substitute placeholders
  if (field.fieldType === 'fill_in_blank') {
    const template = field.helpText || '';
    if (!template) {
      return '—';
    }
    
    // Auto-fill mapping from assignment data
    const autoFillMap: Record<string, string> = {
      'THERAPIST_NAME': assignment.therapist?.fullName || '',
      'THERAPIST_FULL_NAME': assignment.therapist?.fullName || '',
      'THERAPIST_EMAIL': assignment.therapist?.email || '',
      'THERAPIST_PHONE': assignment.therapist?.phoneNumber || '',
      'CLIENT_NAME': assignment.client?.fullName || '',
      'CLIENT_FULL_NAME': assignment.client?.fullName || '',
      'CLIENT_EMAIL': assignment.client?.email || '',
      'CLIENT_PHONE': assignment.client?.phoneNumber || '',
    };
    
    // Parse stored manual values (if any)
    let manualValues: Record<string, string> = {};
    if (rawValue) {
      try {
        manualValues = JSON.parse(rawValue);
      } catch {
        manualValues = {};
      }
    }
    
    // Replace all placeholders in template
    let result = template;
    
    // Replace {{UPPERCASE}} auto-fill placeholders
    result = result.replace(/\{\{([^}]+)\}\}/g, (match, placeholder) => {
      const trimmed = placeholder.trim();
      const value = autoFillMap[trimmed];
      if (value) {
        return `<strong>${escapeHtml(value)}</strong>`;
      }
      return `<strong>[${escapeHtml(trimmed)}]</strong>`;
    });
    
    // Replace [lowercase] manual input placeholders
    result = result.replace(/\[([^\]]+)\]/g, (match, placeholder) => {
      const trimmed = placeholder.trim();
      const value = manualValues[trimmed];
      if (value && String(value).trim() !== '') {
        return `<u>${escapeHtml(value)}</u>`;
      }
      return `<u>[${escapeHtml(trimmed)}]</u>`;
    });
    
    return result;
  }
  
  // Default: escape HTML and return
  return escapeHtml(rawValue || '—');
}

interface FormField {
  id: number;
  label: string;
  fieldType: string;
  helpText?: string | null;
  required: boolean;
  options?: string[] | null;
  placeholder?: string | null;
  sortOrder: number;
}

interface FormTemplate {
  id: number;
  name: string;
  description?: string | null;
}

interface FormAssignment {
  id: number;
  clientId: number;
  templateId: number;
  assignedById: number;
  status: string;
  completedAt?: Date | null;
  client?: {
    id: number;
    fullName: string;
    clientId?: string | null;
    dateOfBirth?: Date | null;
    email?: string | null;
    phoneNumber?: string | null;
  };
  therapist?: {
    id: number;
    fullName: string;
    email?: string | null;
    phoneNumber?: string | null;
  };
  template?: FormTemplate;
  fields?: FormField[];
}

interface FormResponse {
  fieldId: number;
  responseValue: string;
}

interface FormSignature {
  signatureData: string;
  signedAt: Date;
}

interface PracticeSettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

export function generateFormAssignmentHTML(
  assignment: FormAssignment,
  responses: FormResponse[],
  signature: FormSignature | null,
  practiceSettings: PracticeSettings
): string {
  const PRACTICE_TIMEZONE = 'America/New_York';
  
  const completedDate = assignment.completedAt
    ? formatInTimeZone(new Date(assignment.completedAt), PRACTICE_TIMEZONE, 'MMMM dd, yyyy \'at\' h:mm a')
    : 'Not completed';

  const signedDate = signature?.signedAt
    ? formatInTimeZone(new Date(signature.signedAt), PRACTICE_TIMEZONE, 'MMMM dd, yyyy \'at\' h:mm a')
    : null;

  const clientDOB = assignment.client?.dateOfBirth
    ? formatInTimeZone(new Date(assignment.client.dateOfBirth), PRACTICE_TIMEZONE, 'MMMM dd, yyyy')
    : 'Not provided';

  // Create response lookup map
  const responseMap = new Map<number, string>();
  responses.forEach(r => {
    responseMap.set(r.fieldId, r.responseValue);
  });

  // Generate form sections - process all fields in order
  const formSections: string[] = [];
  const sortedFields = assignment.fields?.sort((a, b) => a.sortOrder - b.sortOrder) || [];
  
  // Group consecutive input fields together for table rendering
  let currentInputFields: typeof sortedFields = [];
  
  sortedFields.forEach((field, index) => {
    const isLastField = index === sortedFields.length - 1;
    
    if (field.fieldType === 'heading') {
      // Flush any pending input fields
      if (currentInputFields.length > 0) {
        const tableRows = currentInputFields.map(f => {
          const response = formatFieldResponse(f, responseMap, assignment);
          const fieldTypeLabel = escapeHtml(f.fieldType.charAt(0).toUpperCase() + f.fieldType.slice(1));
          return `
            <tr>
              <td class="field-label">
                ${escapeHtml(f.label)}
                ${f.required ? '<span class="required-mark">*</span>' : ''}
              </td>
              <td class="field-type">${fieldTypeLabel}</td>
              <td class="field-response">${response}</td>
            </tr>
          `;
        }).join('');
        
        formSections.push(`
          <div class="form-fields">
            <table class="fields-table">
              <thead><tr><th>Question</th><th>Type</th><th>Response</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        `);
        currentInputFields = [];
      }
      
      // Add heading
      formSections.push(`
        <div style="margin-top: 24px; margin-bottom: 12px;">
          <h2 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0;">
            ${escapeHtml(field.label)}
          </h2>
        </div>
      `);
    } else if (field.fieldType === 'info_text') {
      // Flush any pending input fields
      if (currentInputFields.length > 0) {
        const tableRows = currentInputFields.map(f => {
          const response = formatFieldResponse(f, responseMap, assignment);
          const fieldTypeLabel = escapeHtml(f.fieldType.charAt(0).toUpperCase() + f.fieldType.slice(1));
          return `
            <tr>
              <td class="field-label">
                ${escapeHtml(f.label)}
                ${f.required ? '<span class="required-mark">*</span>' : ''}
              </td>
              <td class="field-type">${fieldTypeLabel}</td>
              <td class="field-response">${response}</td>
            </tr>
          `;
        }).join('');
        
        formSections.push(`
          <div class="form-fields">
            <table class="fields-table">
              <thead><tr><th>Question</th><th>Type</th><th>Response</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        `);
        currentInputFields = [];
      }
      
      // Add info text (rich HTML content from editor, sanitized to prevent XSS)
      formSections.push(`
        <div style="margin: 16px 0; background-color: #f9fafb; padding: 16px; border-radius: 6px; border: 1px solid #e5e7eb;">
          ${field.label ? `<h3 style="font-size: 16px; font-weight: 600; color: #374151; margin: 0 0 8px 0;">${escapeHtml(field.label)}</h3>` : ''}
          <div style="font-size: 13px; color: #4b5563; line-height: 1.6;">
            ${sanitizeHtml(field.helpText || '')}
          </div>
        </div>
      `);
    } else if (field.fieldType === 'fill_in_blank') {
      // Flush any pending input fields
      if (currentInputFields.length > 0) {
        const tableRows = currentInputFields.map(f => {
          const response = formatFieldResponse(f, responseMap, assignment);
          const fieldTypeLabel = escapeHtml(f.fieldType.charAt(0).toUpperCase() + f.fieldType.slice(1));
          return `
            <tr>
              <td class="field-label">
                ${escapeHtml(f.label)}
                ${f.required ? '<span class="required-mark">*</span>' : ''}
              </td>
              <td class="field-type">${fieldTypeLabel}</td>
              <td class="field-response">${response}</td>
            </tr>
          `;
        }).join('');
        
        formSections.push(`
          <div class="form-fields">
            <table class="fields-table">
              <thead><tr><th>Question</th><th>Type</th><th>Response</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        `);
        currentInputFields = [];
      }
      
      // Render fill-in-blank as paragraph text (like consent statements)
      const formattedText = formatFieldResponse(field, responseMap, assignment);
      formSections.push(`
        <div style="margin: 16px 0; padding: 12px 0;">
          ${field.label ? `<h3 style="font-size: 15px; font-weight: 600; color: #374151; margin: 0 0 8px 0;">${escapeHtml(field.label)}</h3>` : ''}
          <p style="font-size: 14px; color: #1f2937; line-height: 1.7; margin: 0;">
            ${formattedText}
          </p>
        </div>
      `);
    } else if (field.fieldType !== 'signature') {
      // Accumulate input fields
      currentInputFields.push(field);
      
      // Flush if last field
      if (isLastField && currentInputFields.length > 0) {
        const tableRows = currentInputFields.map(f => {
          const response = formatFieldResponse(f, responseMap, assignment);
          const fieldTypeLabel = escapeHtml(f.fieldType.charAt(0).toUpperCase() + f.fieldType.slice(1));
          return `
            <tr>
              <td class="field-label">
                ${escapeHtml(f.label)}
                ${f.required ? '<span class="required-mark">*</span>' : ''}
              </td>
              <td class="field-type">${fieldTypeLabel}</td>
              <td class="field-response">${response}</td>
            </tr>
          `;
        }).join('');
        
        formSections.push(`
          <div class="form-fields">
            <table class="fields-table">
              <thead><tr><th>Question</th><th>Type</th><th>Response</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </div>
        `);
      }
    }
  });
  
  const formContent = formSections.join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: 'Helvetica', 'Arial', sans-serif;
          padding: 20px 30px;
          line-height: 1.5;
          color: #333;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #2563eb;
          padding-bottom: 12px;
          margin-bottom: 15px;
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
          font-weight: 600;
          color: #1e40af;
          font-size: 16px;
          margin-bottom: 8px;
        }
        h1 {
          color: #1e40af;
          margin: 0 0 6px 0;
          font-size: 26px;
        }
        .form-title {
          color: #1e40af;
          font-size: 22px;
          margin: 15px 0 10px 0;
          font-weight: 700;
        }
        .confidentiality-banner {
          background-color: #fef3c7;
          border-left: 4px solid #f59e0b;
          padding: 10px 15px;
          margin: 12px 0;
          text-align: center;
          font-size: 12px;
          font-weight: 600;
          color: #92400e;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        }
        .client-info {
          background-color: #f3f4f6;
          border-radius: 6px;
          padding: 12px 15px;
          margin: 12px 0 20px 0;
        }
        .client-info-title {
          font-size: 16px;
          font-weight: 700;
          color: #1e40af;
          margin-bottom: 12px;
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
        .form-fields {
          margin: 20px 0;
        }
        .fields-table {
          width: 100%;
          border-collapse: collapse;
          margin: 15px 0;
        }
        .fields-table th {
          background-color: #dbeafe;
          color: #1e40af;
          font-weight: 700;
          text-align: left;
          padding: 10px 12px;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .fields-table td {
          padding: 10px 12px;
          border-bottom: 1px solid #e5e7eb;
          vertical-align: top;
        }
        .field-label {
          font-weight: 600;
          color: #374151;
          width: 40%;
        }
        .field-type {
          color: #6b7280;
          font-size: 12px;
          width: 15%;
        }
        .field-response {
          color: #1f2937;
          width: 45%;
          white-space: pre-wrap;
        }
        .required-mark {
          color: #dc2626;
          margin-left: 4px;
        }
        .no-fields {
          text-align: center;
          color: #9ca3af;
          padding: 20px;
          font-style: italic;
        }
        .signature-section {
          margin: 30px 0 20px 0;
          padding: 20px;
          background-color: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
        }
        .signature-title {
          font-size: 16px;
          font-weight: 700;
          color: #1e40af;
          margin-bottom: 15px;
          padding-bottom: 8px;
          border-bottom: 2px solid #dbeafe;
        }
        .signature-image {
          border: 2px solid #d1d5db;
          border-radius: 4px;
          padding: 10px;
          background-color: white;
          max-width: 400px;
          margin: 10px 0;
        }
        .signature-image img {
          max-width: 100%;
          height: auto;
        }
        .signature-date {
          font-size: 13px;
          color: #6b7280;
          margin-top: 8px;
          font-style: italic;
        }
        .footer {
          margin-top: 40px;
          padding-top: 15px;
          border-top: 2px solid #e5e7eb;
          text-align: center;
          font-size: 11px;
          color: #9ca3af;
        }
        .footer p {
          margin: 5px 0;
        }
        @media print {
          body {
            padding: 10px 20px;
          }
          .no-print {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="header-left">
          <div class="practice-name">${escapeHtml(practiceSettings.name)}</div>
          <div>${escapeHtml(practiceSettings.address)}</div>
          <div>${escapeHtml(practiceSettings.phone)} | ${escapeHtml(practiceSettings.email)}</div>
        </div>
        <div class="header-right">
          <div><strong>Completed:</strong> ${escapeHtml(completedDate)}</div>
        </div>
      </div>

      <h1>Clinical Form</h1>
      
      <div class="confidentiality-banner">
        CONFIDENTIAL PATIENT INFORMATION — HIPAA PROTECTED
      </div>

      <div class="form-title">${escapeHtml(assignment.template?.name || 'Untitled Form')}</div>
      ${assignment.template?.description ? `<p style="color: #6b7280; margin: 5px 0 15px 0;">${escapeHtml(assignment.template.description)}</p>` : ''}

      <div class="client-info">
        <div class="client-info-title">Client Information</div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Client Name</div>
            <div class="info-value">${escapeHtml(assignment.client?.fullName || 'Unknown')}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Client ID</div>
            <div class="info-value">${escapeHtml(assignment.client?.clientId || 'N/A')}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Date of Birth</div>
            <div class="info-value">${escapeHtml(clientDOB)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Email</div>
            <div class="info-value">${escapeHtml(assignment.client?.email || 'Not provided')}</div>
          </div>
        </div>
      </div>

      ${formContent}

      ${signature && isValidSignatureDataUrl(signature.signatureData) ? `
        <div class="signature-section">
          <div class="signature-title">Electronic Signature</div>
          <div class="signature-image">
            <img src="${signature.signatureData}" alt="Client Signature" />
          </div>
          <div class="signature-date">
            Signed on ${escapeHtml(signedDate || '')}
          </div>
          <p style="font-size: 12px; color: #6b7280; margin-top: 10px;">
            By signing this form electronically, the client certifies that the information provided is accurate and complete.
          </p>
        </div>
      ` : `
        <div class="signature-section">
          <div class="signature-title">Electronic Signature</div>
          <p style="color: #9ca3af; font-style: italic;">${signature && !isValidSignatureDataUrl(signature.signatureData) ? 'Invalid signature format' : 'No signature captured'}</p>
        </div>
      `}

      <div class="footer">
        <p>This form was generated electronically and is valid without a physical signature.</p>
        <p>${escapeHtml(practiceSettings.name)} | ${escapeHtml(practiceSettings.phone)} | ${escapeHtml(practiceSettings.email)}</p>
        <p style="margin-top: 10px;">Generated on ${escapeHtml(formatInTimeZone(new Date(), PRACTICE_TIMEZONE, 'MMMM dd, yyyy \'at\' h:mm a'))}</p>
      </div>
    </body>
    </html>
  `;

  return html;
}
