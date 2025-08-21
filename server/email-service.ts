import SparkPost from 'sparkpost';
import crypto from 'crypto';

interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

export class EmailService {
  private client: SparkPost;
  private fromEmail: string;
  private fromName: string;

  constructor(config: EmailConfig) {
    this.client = new SparkPost(config.apiKey);
    this.fromEmail = config.fromEmail;
    this.fromName = config.fromName;
  }

  async sendPasswordResetEmail(email: string, resetToken: string, userFullName: string): Promise<void> {
    // Auto-detect the correct base URL for password reset links
    let baseUrl = process.env.FRONTEND_URL;
    
    if (!baseUrl) {
      // Check if we're running in Replit production environment
      if (process.env.REPLIT_DOMAINS) {
        // Use the primary Replit domain
        const domains = process.env.REPLIT_DOMAINS.split(',');
        baseUrl = `https://${domains[0].trim()}`;
      } else if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
        // Fallback to standard Replit URL format
        baseUrl = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;
      } else {
        // Development fallback
        baseUrl = 'http://localhost:5000';
      }
    }
    
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;
    
    const emailData = {
      options: {
        sandbox: false
      },
      content: {
        from: {
          email: 'noreply@send.rcrc.ca',
          name: 'TherapyFlow'
        },
        subject: 'Reset Your TherapyFlow Password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; }
              .content { padding: 30px; background-color: #f9f9f9; }
              .button { 
                display: inline-block; 
                background-color: #4F46E5; 
                color: white; 
                padding: 12px 30px; 
                text-decoration: none; 
                border-radius: 5px; 
                margin: 20px 0;
              }
              .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>TherapyFlow</h1>
              </div>
              <div class="content">
                <h2>Password Reset Request</h2>
                <p>Hello ${userFullName || 'User'},</p>
                <p>We received a request to reset your password for your TherapyFlow account. If you made this request, click the button below to reset your password:</p>
                <div style="text-align: center;">
                  <a href="${resetUrl}" class="button">Reset Password</a>
                </div>
                <p>Or copy and paste this link into your browser:</p>
                <p style="word-break: break-all; background-color: #e5e5e5; padding: 10px;">${resetUrl}</p>
                <p><strong>This link will expire in 1 hour for security reasons.</strong></p>
                <p>If you didn't request this password reset, please ignore this email and your password will remain unchanged.</p>
                <p>For security, this request was made from IP address and will be logged in our audit system.</p>
              </div>
              <div class="footer">
                <p>This is an automated message from TherapyFlow. Please do not reply to this email.</p>
                <p>If you have any questions, please contact your system administrator.</p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
          TherapyFlow - Password Reset Request
          
          Hello ${userFullName || 'User'},
          
          We received a request to reset your password for your TherapyFlow account.
          
          To reset your password, copy and paste this link into your browser:
          ${resetUrl}
          
          This link will expire in 1 hour for security reasons.
          
          If you didn't request this password reset, please ignore this email and your password will remain unchanged.
          
          This is an automated message from TherapyFlow.
        `
      },
      recipients: [
        {
          address: {
            email: email,
            name: userFullName || 'User'
          }
        }
      ]
    };

    try {
      await this.client.transmissions.send(emailData);
      console.log(`Password reset email sent successfully to ${email}`);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  static generateResetToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  static getTokenExpiry(): Date {
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 1); // 1 hour from now
    return expiry;
  }
}

// Singleton instance
let emailService: EmailService | null = null;

export function getEmailService(): EmailService {
  if (!emailService) {
    const apiKey = process.env.SPARKPOST_API_KEY;
    const fromEmail = process.env.FROM_EMAIL || 'noreply@therapyflow.com';
    const fromName = process.env.FROM_NAME || 'TherapyFlow';

    if (!apiKey) {
      throw new Error('SPARKPOST_API_KEY environment variable is required');
    }

    emailService = new EmailService({
      apiKey,
      fromEmail,
      fromName
    });
  }

  return emailService;
}