import { z } from "zod";
import { format, toZonedTime } from 'date-fns-tz';

// Zoom API configuration
const ZOOM_API_BASE = "https://api.zoom.us/v2";

// Zoom meeting configuration schema
const zoomMeetingSchema = z.object({
  topic: z.string(),
  type: z.number().default(2), // 2 = scheduled meeting
  start_time: z.string(), // ISO 8601 format
  duration: z.number().default(60), // Duration in minutes
  timezone: z.string().default("America/New_York"),
  password: z.string().optional(),
  settings: z.object({
    host_video: z.boolean().default(true),
    participant_video: z.boolean().default(true),
    join_before_host: z.boolean().default(false),
    mute_upon_entry: z.boolean().default(true),
    waiting_room: z.boolean().default(true),
    auto_recording: z.string().default("none"), // "local", "cloud", "none"
  }).optional(),
});

// Zoom meeting response schema
const zoomMeetingResponseSchema = z.object({
  id: z.number(),
  host_id: z.string(),
  topic: z.string(),
  start_time: z.string(),
  duration: z.number(),
  timezone: z.string(),
  join_url: z.string(),
  password: z.string().optional(),
  encrypted_password: z.string().optional(),
});

export type ZoomMeetingRequest = z.infer<typeof zoomMeetingSchema>;
export type ZoomMeetingResponse = z.infer<typeof zoomMeetingResponseSchema>;

export class ZoomService {
  private accountId: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.accountId = process.env.ZOOM_ACCOUNT_ID || "";
    this.clientId = process.env.ZOOM_CLIENT_ID || "";
    this.clientSecret = process.env.ZOOM_CLIENT_SECRET || "";
    
    if (!this.accountId || !this.clientId || !this.clientSecret) {
      console.warn("[ZOOM] Global Zoom OAuth credentials not configured - Therapists must configure individual accounts");
    } else {
      console.log("[ZOOM] Global Zoom OAuth credentials configured (fallback)");
    }
  }

  /**
   * Check if Zoom service is properly configured (global fallback)
   */
  isConfigured(): boolean {
    return !!(this.accountId && this.clientId && this.clientSecret);
  }

  /**
   * Check if therapist has their own Zoom credentials configured
   */
  isTherapistConfigured(therapistCredentials: {
    accountId?: string | null;
    clientId?: string | null;
    clientSecret?: string | null;
  }): boolean {
    return !!(therapistCredentials.accountId && therapistCredentials.clientId && therapistCredentials.clientSecret);
  }

  /**
   * Get access token using Server to Server OAuth
   * Supports both per-therapist credentials and global fallback
   */
  private async getAccessToken(therapistCredentials?: {
    accountId: string;
    clientId: string;
    clientSecret: string;
    accessToken?: string | null;
    tokenExpiry?: Date | null;
  }): Promise<string> {
    // Use therapist credentials if provided, otherwise fall back to global
    const accountId = therapistCredentials?.accountId || this.accountId;
    const clientId = therapistCredentials?.clientId || this.clientId;
    const clientSecret = therapistCredentials?.clientSecret || this.clientSecret;

    // Check cached token (for therapist or global)
    if (therapistCredentials?.accessToken && therapistCredentials?.tokenExpiry) {
      const expiry = new Date(therapistCredentials.tokenExpiry).getTime();
      if (Date.now() < expiry) {
        console.log("[ZOOM] Using cached therapist access token");
        return therapistCredentials.accessToken;
      }
    } else if (!therapistCredentials && this.accessToken && Date.now() < this.tokenExpiry) {
      console.log("[ZOOM] Using cached global access token");
      return this.accessToken;
    }

    try {
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      
      const response = await fetch('https://zoom.us/oauth/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'account_credentials',
          account_id: accountId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("[ZOOM] Failed to get access token:", response.status, errorData);
        
        if (response.status === 400) {
          throw new Error(`Zoom OAuth configuration error: Please check your Server-to-Server OAuth app settings in Zoom Marketplace. Ensure the app is activated and credentials are correct. Details: ${errorData}`);
        }
        
        throw new Error(`Failed to get Zoom access token: ${response.status} - ${errorData}`);
      }

      const tokenData = await response.json();
      
      if (!tokenData.access_token) {
        throw new Error('No access token received from Zoom OAuth');
      }
      
      // Cache token (global or return for therapist to cache)
      if (!therapistCredentials) {
        this.accessToken = tokenData.access_token;
        this.tokenExpiry = Date.now() + (tokenData.expires_in - 300) * 1000;
        console.log("[ZOOM] Global access token obtained successfully");
      } else {
        console.log("[ZOOM] Therapist access token obtained successfully");
      }
      
      return tokenData.access_token;
    } catch (error) {
      console.error("[ZOOM] Error getting access token:", error);
      throw error;
    }
  }

  /**
   * Get headers for Zoom API requests
   */
  private async getHeaders(therapistCredentials?: {
    accountId: string;
    clientId: string;
    clientSecret: string;
    accessToken?: string | null;
    tokenExpiry?: Date | null;
  }) {
    const token = await this.getAccessToken(therapistCredentials);
    if (!token) {
      throw new Error('Failed to obtain Zoom access token');
    }
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a Zoom meeting for a therapy session
   * Uses therapist's own Zoom account if credentials provided
   */
  async createMeeting(sessionData: {
    clientName: string;
    therapistName: string;
    sessionDate: Date;
    duration?: number;
  }, therapistCredentials?: {
    accountId: string;
    clientId: string;
    clientSecret: string;
    accessToken?: string | null;
    tokenExpiry?: Date | null;
  }): Promise<ZoomMeetingResponse> {
    // Check if either therapist or global credentials are configured
    const hasCredentials = therapistCredentials 
      ? this.isTherapistConfigured(therapistCredentials)
      : this.isConfigured();

    if (!hasCredentials) {
      throw new Error("Zoom service not configured - please set OAuth credentials in your profile");
    }

    try {
      const meetingData: ZoomMeetingRequest = {
        topic: `Therapy Session with ${sessionData.therapistName}`,
        type: 2, // Scheduled meeting
        start_time: format(toZonedTime(sessionData.sessionDate, 'America/New_York'), "yyyy-MM-dd'T'HH:mm:ss"),
        duration: sessionData.duration || 60,
        timezone: "America/New_York",
        password: this.generateMeetingPassword(),
        settings: {
          host_video: true,
          participant_video: true,
          join_before_host: false,
          mute_upon_entry: true,
          waiting_room: true,
          auto_recording: "none",
        },
      };

      console.log("[ZOOM] Creating meeting:", { 
        topic: meetingData.topic, 
        start_time: meetingData.start_time,
        using: therapistCredentials ? 'therapist credentials' : 'global credentials'
      });

      const response = await fetch(`${ZOOM_API_BASE}/users/me/meetings`, {
        method: 'POST',
        headers: await this.getHeaders(therapistCredentials),
        body: JSON.stringify(meetingData),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("[ZOOM] Failed to create meeting:", response.status, errorData);
        throw new Error(`Failed to create Zoom meeting: ${response.status} ${errorData}`);
      }

      const result = await response.json();
      const validatedResult = zoomMeetingResponseSchema.parse(result);

      console.log("[ZOOM] Meeting created successfully:", { 
        id: validatedResult.id, 
        topic: validatedResult.topic
      });

      return validatedResult;
    } catch (error) {
      console.error("[ZOOM] Error creating meeting:", error);
      throw error;
    }
  }

  /**
   * Update an existing Zoom meeting
   */
  async updateMeeting(meetingId: string, updateData: Partial<ZoomMeetingRequest>): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("Zoom service not configured - please set OAuth credentials");
    }

    try {
      console.log("[ZOOM] Updating meeting:", meetingId);

      const response = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}`, {
        method: 'PATCH',
        headers: await this.getHeaders(),
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("[ZOOM] Failed to update meeting:", response.status, errorData);
        throw new Error(`Failed to update Zoom meeting: ${response.status} ${errorData}`);
      }

      console.log("[ZOOM] Meeting updated successfully:", meetingId);
    } catch (error) {
      console.error("[ZOOM] Error updating meeting:", error);
      throw error;
    }
  }

  /**
   * Delete a Zoom meeting
   */
  async deleteMeeting(meetingId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error("Zoom service not configured - please set OAuth credentials");
    }

    try {
      console.log("[ZOOM] Deleting meeting:", meetingId);

      const response = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}`, {
        method: 'DELETE',
        headers: await this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("[ZOOM] Failed to delete meeting:", response.status, errorData);
        throw new Error(`Failed to delete Zoom meeting: ${response.status} ${errorData}`);
      }

      console.log("[ZOOM] Meeting deleted successfully:", meetingId);
    } catch (error) {
      console.error("[ZOOM] Error deleting meeting:", error);
      throw error;
    }
  }

  /**
   * Get meeting details
   */
  async getMeeting(meetingId: string): Promise<ZoomMeetingResponse> {
    if (!this.isConfigured()) {
      throw new Error("Zoom service not configured - please set OAuth credentials");
    }

    try {
      const response = await fetch(`${ZOOM_API_BASE}/meetings/${meetingId}`, {
        method: 'GET',
        headers: await this.getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("[ZOOM] Failed to get meeting:", response.status, errorData);
        throw new Error(`Failed to get Zoom meeting: ${response.status} ${errorData}`);
      }

      const result = await response.json();
      return zoomMeetingResponseSchema.parse(result);
    } catch (error) {
      console.error("[ZOOM] Error getting meeting:", error);
      throw error;
    }
  }

  /**
   * Generate a random meeting password
   */
  private generateMeetingPassword(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  /**
   * Format meeting information for display
   */
  formatMeetingInfo(meeting: ZoomMeetingResponse): {
    meetingId: string;
    joinUrl: string;
    password: string;
    startTime: string;
  } {
    // Convert Zoom's UTC time back to EST for consistent display
    const utcDate = new Date(meeting.start_time);
    const estDate = toZonedTime(utcDate, 'America/New_York');
    const estTimeString = format(estDate, "yyyy-MM-dd'T'HH:mm:ssXXX", {
      timeZone: 'America/New_York'
    });

    return {
      meetingId: meeting.id.toString(),
      joinUrl: meeting.join_url,
      password: meeting.password || '',
      startTime: estTimeString,
    };
  }
}

// Export singleton instance
export const zoomService = new ZoomService();