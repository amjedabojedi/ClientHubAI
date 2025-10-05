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
  therapist: {
    id: number;
    fullName: string;
  };
  client?: {
    id: number;
    firstName: string;
    lastName: string;
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
            padding: 40px;
            line-height: 1.6;
            color: #333;
          }
          .header {
            border-bottom: 3px solid #2563eb;
            padding-bottom: 20px;
            margin-bottom: 30px;
          }
          h1 {
            color: #1e40af;
            margin: 0 0 10px 0;
            font-size: 28px;
          }
          .meta-info {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin: 20px 0;
            padding: 20px;
            background-color: #f3f4f6;
            border-radius: 8px;
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
            margin: 25px 0;
            page-break-inside: avoid;
          }
          .section-title {
            font-weight: 700;
            color: #1e40af;
            font-size: 16px;
            margin-bottom: 10px;
            padding-bottom: 5px;
            border-bottom: 2px solid #dbeafe;
          }
          .content {
            margin-top: 20px;
            font-size: 14px;
          }
          .content h2 {
            color: #1e40af;
            font-size: 18px;
            margin: 20px 0 10px 0;
            font-weight: 700;
          }
          .content p {
            margin: 8px 0;
            line-height: 1.6;
          }
          .content strong {
            font-weight: 600;
            color: #1f2937;
          }
          .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #e5e7eb;
            font-size: 12px;
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
            ${note.client ? `${note.client.firstName} ${note.client.lastName}` : 'Client'}
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
        </div>

        ${note.moodBefore || note.moodAfter ? `
          <div class="section">
            <div class="section-title">Mood Assessment</div>
            <div style="display: flex; gap: 20px;">
              ${note.moodBefore ? `<p><strong>Before Session:</strong> ${note.moodBefore}/10</p>` : ''}
              ${note.moodAfter ? `<p><strong>After Session:</strong> ${note.moodAfter}/10</p>` : ''}
            </div>
          </div>
        ` : ''}

        ${note.sessionFocus ? `
          <div class="section">
            <div class="section-title">Session Focus</div>
            <p>${note.sessionFocus}</p>
          </div>
        ` : ''}

        ${note.symptoms ? `
          <div class="section">
            <div class="section-title">Symptoms</div>
            <p>${note.symptoms}</p>
          </div>
        ` : ''}

        ${note.shortTermGoals ? `
          <div class="section">
            <div class="section-title">Short-term Goals</div>
            <p>${note.shortTermGoals}</p>
          </div>
        ` : ''}

        ${note.intervention ? `
          <div class="section">
            <div class="section-title">Intervention</div>
            <p>${note.intervention}</p>
          </div>
        ` : ''}

        ${note.progress ? `
          <div class="section">
            <div class="section-title">Progress</div>
            <p>${note.progress}</p>
          </div>
        ` : ''}

        ${note.remarks ? `
          <div class="section">
            <div class="section-title">Remarks</div>
            <p>${note.remarks}</p>
          </div>
        ` : ''}

        ${note.recommendations ? `
          <div class="section">
            <div class="section-title">Recommendations</div>
            <p>${note.recommendations}</p>
          </div>
        ` : ''}

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
          <p>Session Note ID: ${note.id}</p>
        </div>
      </body>
      </html>
    `;

  return html;
}
