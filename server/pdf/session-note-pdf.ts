import { format } from 'date-fns';

interface SessionNote {
  id: number;
  sessionId: number;
  clientId: number;
  therapistId: number;
  date: string;
  sessionFocus?: string | null;
  symptoms?: string | null;
  shortTermGoals?: string | null;
  intervention?: string | null;
  progress?: string | null;
  remarks?: string | null;
  recommendations?: string | null;
  moodBefore?: number | null;
  moodAfter?: number | null;
  generatedContent?: string | null;
  draftContent?: string | null;
  finalContent?: string | null;
  isDraft: boolean;
  isFinalized: boolean;
  finalizedAt?: Date | null;
  therapist: {
    id: number;
    fullName: string;
  };
  client?: {
    id: number;
    fullName: string;
  };
  session: {
    id: number;
    sessionDate: string;
    sessionType: string;
    room?: { roomName: string } | null;
  };
}

export function generateSessionNoteHTML(note: SessionNote): string {
  // Format date
  const formattedDate = format(new Date(note.date), 'MMMM dd, yyyy');
  const sessionDate = format(new Date(note.session.sessionDate), 'MMMM dd, yyyy');
  const finalizedDate = note.finalizedAt ? format(new Date(note.finalizedAt), 'MMMM dd, yyyy h:mm a') : null;
    
    // Get content to display (prioritize final, then generated, then draft)
    const content = note.finalContent || note.generatedContent || note.draftContent || '';
    
    // Create HTML for PDF
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
            border-bottom: 3px solid #2563eb;
            padding-bottom: 12px;
            margin-bottom: 15px;
          }
          h1 {
            color: #1e40af;
            margin: 0 0 6px 0;
            font-size: 26px;
          }
          .meta-info {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin: 12px 0 15px 0;
            padding: 12px 15px;
            background-color: #f3f4f6;
            border-radius: 6px;
          }
          .meta-item {
            margin: 0;
          }
          .meta-label {
            font-weight: 600;
            color: #4b5563;
            font-size: 12px;
            text-transform: uppercase;
            margin-bottom: 4px;
          }
          .meta-value {
            font-size: 14px;
            color: #1f2937;
          }
          .section {
            margin: 15px 0 0 0;
            page-break-inside: avoid;
            background-color: #ffffff;
          }
          .section-title {
            font-weight: 700;
            color: #1e40af;
            font-size: 16px;
            margin-bottom: 8px;
            padding-bottom: 5px;
            border-bottom: 2px solid #dbeafe;
            letter-spacing: 0.3px;
          }
          .section p {
            margin: 5px 0;
            line-height: 1.6;
            color: #374151;
            white-space: pre-wrap;
            word-wrap: break-word;
          }
          .content {
            margin-top: 8px;
            font-size: 14px;
            line-height: 1.6;
          }
          .content h1 {
            color: #1e40af;
            font-size: 19px;
            margin: 15px 0 8px 0;
            font-weight: 700;
            border-bottom: 2px solid #dbeafe;
            padding-bottom: 5px;
          }
          .content h2 {
            color: #1e40af;
            font-size: 17px;
            margin: 12px 0 6px 0;
            font-weight: 700;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 4px;
          }
          .content h3 {
            color: #2563eb;
            font-size: 15px;
            margin: 10px 0 5px 0;
            font-weight: 600;
          }
          .content h4 {
            color: #3b82f6;
            font-size: 14px;
            margin: 8px 0 4px 0;
            font-weight: 600;
          }
          .content p {
            margin: 6px 0;
            line-height: 1.6;
            color: #374151;
          }
          .content strong {
            font-weight: 600;
            color: #1f2937;
          }
          .content em {
            font-style: italic;
            color: #4b5563;
          }
          .content ul, .content ol {
            margin: 6px 0;
            padding-left: 25px;
            line-height: 1.6;
          }
          .content ul li, .content ol li {
            margin: 4px 0;
            color: #374151;
          }
          .content ul {
            list-style-type: disc;
          }
          .content ol {
            list-style-type: decimal;
          }
          .content blockquote {
            margin: 8px 0;
            padding: 8px 15px;
            border-left: 4px solid #3b82f6;
            background-color: #f3f4f6;
            font-style: italic;
            color: #4b5563;
          }
          .content code {
            background-color: #f3f4f6;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            color: #1f2937;
          }
          .content pre {
            background-color: #f3f4f6;
            padding: 8px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
          }
          .content pre code {
            background-color: transparent;
            padding: 0;
          }
          .content hr {
            border: none;
            border-top: 1px solid #d1d5db;
            margin: 10px 0;
          }
          .content table {
            width: 100%;
            border-collapse: collapse;
            margin: 8px 0;
          }
          .content table th,
          .content table td {
            border: 1px solid #d1d5db;
            padding: 6px 10px;
            text-align: left;
          }
          .content table th {
            background-color: #f3f4f6;
            font-weight: 600;
            color: #1f2937;
          }
          .content a {
            color: #2563eb;
            text-decoration: underline;
          }
          .footer {
            margin-top: 20px;
            padding-top: 12px;
            border-top: 2px solid #e5e7eb;
            font-size: 11px;
            color: #6b7280;
            text-align: center;
          }
          .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            margin-left: 10px;
          }
          .status-finalized {
            background-color: #dbeafe;
            color: #1e40af;
          }
          .status-draft {
            background-color: #fef3c7;
            color: #92400e;
          }
          hr {
            border: none;
            border-top: 1px solid #e5e7eb;
            margin: 20px 0;
          }
          
          @media print {
            @page {
              margin: 0.4in 0.5in;
            }
            body {
              padding: 0;
              line-height: 1.35;
              margin: 0;
            }
            .header {
              padding-bottom: 4px;
              margin-bottom: 4px;
              page-break-after: avoid;
            }
            h1 {
              margin: 0 0 2px 0;
              font-size: 20px;
              page-break-after: avoid;
            }
            .meta-info {
              gap: 4px;
              margin: 4px 0 6px 0;
              padding: 6px 8px;
              page-break-after: avoid;
              page-break-inside: avoid;
            }
            .meta-label {
              font-size: 11px;
              margin-bottom: 2px;
            }
            .meta-value {
              font-size: 13px;
            }
            .section {
              margin: 4px 0 0 0;
            }
            .section-title {
              margin-bottom: 3px;
              padding-bottom: 2px;
              font-size: 14px;
              page-break-after: avoid;
            }
            .section p {
              margin: 2px 0;
              line-height: 1.35;
            }
            .content {
              margin-top: 3px;
              line-height: 1.35;
            }
            .content h1 {
              margin: 6px 0 3px 0;
              padding-bottom: 2px;
              font-size: 16px;
              page-break-after: avoid;
            }
            .content h2 {
              margin: 5px 0 2px 0;
              padding-bottom: 2px;
              font-size: 14px;
              page-break-after: avoid;
            }
            .content h3 {
              margin: 4px 0 2px 0;
              font-size: 13px;
              page-break-after: avoid;
            }
            .content h4 {
              margin: 3px 0 1px 0;
              font-size: 12px;
              page-break-after: avoid;
            }
            .content p {
              margin: 2px 0;
              line-height: 1.35;
            }
            .content ul, .content ol {
              margin: 2px 0;
              padding-left: 16px;
              line-height: 1.35;
            }
            .content ul li, .content ol li {
              margin: 1px 0;
            }
            .content blockquote {
              margin: 3px 0;
              padding: 3px 8px;
              page-break-inside: avoid;
            }
            .content pre {
              padding: 3px;
              margin: 3px 0;
              page-break-inside: avoid;
            }
            .content hr {
              margin: 4px 0;
            }
            .content table {
              margin: 3px 0;
              page-break-inside: avoid;
            }
            .content table th,
            .content table td {
              padding: 2px 5px;
            }
            .footer {
              margin-top: 8px;
              padding-top: 4px;
              font-size: 9px;
              page-break-before: avoid;
            }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>
            Session Note
            ${note.isFinalized ? '<span class="status-badge status-finalized">Finalized</span>' : ''}
            ${note.isDraft ? '<span class="status-badge status-draft">Draft</span>' : ''}
          </h1>
          <p style="margin: 5px 0; color: #6b7280;">
            ${note.client ? note.client.fullName : 'Client'}
          </p>
        </div>

        <div class="meta-info">
          <div class="meta-item">
            <div class="meta-label">Session Date</div>
            <div class="meta-value">${sessionDate}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Service Type</div>
            <div class="meta-value">${note.session.sessionType}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Therapist</div>
            <div class="meta-value">${note.therapist.fullName}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Room</div>
            <div class="meta-value">${note.session.room?.roomName || 'Not specified'}</div>
          </div>
          ${note.isFinalized && finalizedDate ? `
          <div class="meta-item">
            <div class="meta-label">Finalized</div>
            <div class="meta-value">${finalizedDate}</div>
          </div>
          ` : ''}
        </div>


        ${content ? `
          <div class="section">
            <div class="section-title">Clinical Documentation</div>
            <div class="content">
              ${content}
            </div>
          </div>
        ` : ''}

        <div class="footer">
          <p>Generated on ${format(new Date(), 'MMMM dd, yyyy \'at\' hh:mm a')}</p>
        </div>
      </body>
      </html>
    `;

  return html;
}
