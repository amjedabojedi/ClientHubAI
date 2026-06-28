import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AuditAction } from "@shared/schema";
import { formatDateInput, formatDateAudit, formatDateDisplay } from "@/lib/datetime";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  AlertTriangle,
  Download,
  Search,
  Filter,
  Eye,
  UserCheck,
  FileText,
  AlertCircle,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface AuditLog {
  id: number;
  userId: number | null;
  username: string;
  action: string;
  result: string;
  resourceType: string;
  resourceId: string;
  clientId: number | null;
  clientName: string | null;
  ipAddress: string;
  userAgent: string;
  riskLevel: string;
  timestamp: string;
  hipaaRelevant: boolean;
  details: string;
}

interface UserActivity {
  username: string;
  activityCount: number;
  lastActivity: string;
}

// Human-readable label for every audit action type. Keeps the Action column
// readable instead of raw snake_case (e.g. "session_transcript_viewed").
// `satisfies Record<AuditAction, string>` makes the compiler fail if a new
// action is ever added to AUDIT_ACTIONS without a label here (prevents drift).
const AUDIT_ACTION_LABELS = {
  // Authentication
  login: 'Logged In',
  logout: 'Logged Out',
  login_failed: 'Failed Login',
  password_changed: 'Password Changed',
  account_locked: 'Account Locked',
  unauthorized_access: 'Unauthorized Access',
  // Client lifecycle
  client_viewed: 'Client Viewed',
  client_created: 'Client Created',
  client_updated: 'Client Updated',
  client_deleted: 'Client Deleted',
  client_status_changed: 'Client Status Changed',
  client_assigned: 'Client Assigned',
  client_transferred: 'Client Transferred',
  // Bulk client operations
  bulk_update_stage: 'Bulk Stage Update',
  bulk_reassign_therapist: 'Bulk Therapist Reassign',
  bulk_portal_access: 'Bulk Portal Access Update',
  bulk_update_status: 'Bulk Status Update',
  // Sessions / appointments
  session_viewed: 'Session Viewed',
  session_created: 'Session Created',
  session_updated: 'Session Updated',
  session_deleted: 'Session Deleted',
  session_cancelled: 'Session Cancelled',
  session_rescheduled: 'Session Rescheduled',
  session_completed: 'Session Completed',
  session_no_show: 'Session No-Show',
  appointments_viewed: 'Appointments Viewed',
  // Session notes
  note_created: 'Note Created',
  note_updated: 'Note Updated',
  note_viewed: 'Note Viewed',
  note_deleted: 'Note Deleted',
  note_ai_generated: 'Note AI-Generated',
  notes_viewed: 'Notes Viewed',
  finalize_session_note: 'Note Finalized',
  // Session transcripts / voice
  session_transcript_created: 'Transcript Created',
  session_transcript_viewed: 'Transcript Viewed',
  session_transcript_smart_fill: 'Transcript Smart-Fill',
  session_transcript_deleted: 'Transcript Deleted',
  voice_transcription_new_note: 'Voice Note Created',
  voice_transcription_processed: 'Voice Transcription Processed',
  voice_transcription_failed: 'Voice Transcription Failed',
  assessment_voice_transcribed: 'Assessment Voice Transcribed',
  // Documents
  document_viewed: 'Document Viewed',
  document_uploaded: 'Document Uploaded',
  document_downloaded: 'Document Downloaded',
  document_deleted: 'Document Deleted',
  document_shared: 'Document Shared',
  document_shared_in_portal: 'Document Shared In Portal',
  document_unshared_from_portal: 'Document Removed From Portal',
  document_modified: 'Document Modified',
  document_approved: 'Document Approved',
  document_rejected: 'Document Rejected',
  documents_viewed: 'Documents Viewed',
  // Assessments
  assessment_viewed: 'Assessment Viewed',
  assessment_created: 'Assessment Created',
  assessment_updated: 'Assessment Updated',
  assessment_completed: 'Assessment Completed',
  assessment_assigned: 'Assessment Assigned',
  assessment_report_generated: 'Assessment Report Generated',
  // Forms
  forms_list_viewed: 'Forms List Viewed',
  form_viewed: 'Form Viewed',
  form_signature_cleared: 'Form Signature Cleared',
  form_signed: 'Form Signed',
  form_submitted: 'Form Submitted',
  form_assignment_deleted: 'Form Assignment Deleted',
  // Billing
  billing_created: 'Billing Created',
  billing_updated: 'Billing Updated',
  billing_status_changed: 'Billing Status Changed',
  payment_recorded: 'Payment Recorded',
  invoice_sent: 'Invoice Sent',
  invoices_viewed: 'Invoices Viewed',
  invoice_viewed: 'Invoice Viewed',
  payment_initiated: 'Payment Initiated',
  payment_completed: 'Payment Completed',
  // Consent / compliance
  consent_granted: 'Consent Granted',
  consent_withdrawn: 'Consent Withdrawn',
  ai_processing_blocked: 'AI Processing Blocked',
  // SMS notifications
  sms_notification_sent: 'SMS Sent',
  sms_notification_failed: 'SMS Failed',
  sms_notification_blocked: 'SMS Blocked',
  sms_notification_skipped: 'SMS Skipped',
  // Email notifications
  email_notification_sent: 'Email Sent',
  email_notification_failed: 'Email Failed',
  email_notification_blocked: 'Email Blocked',
  email_notification_skipped: 'Email Skipped',
  // Report templates & AI client reports
  report_template_created: 'Report Template Created',
  report_template_updated: 'Report Template Updated',
  report_template_deleted: 'Report Template Deleted',
  client_report_generated: 'Client Report Generated',
  client_report_finalized: 'Client Report Finalized',
  client_report_reopened: 'Client Report Reopened',
  report_supporting_file_uploaded: 'Report File Uploaded',
  report_supporting_file_deleted: 'Report File Deleted',
  report_supporting_file_downloaded: 'Report File Downloaded',
  // Calendar feed
  calendar_feed_accessed: 'Calendar Feed Accessed',
  calendar_feed_token_generated: 'Calendar Link Created',
  calendar_feed_token_revoked: 'Calendar Link Revoked',
  // Data export
  data_exported: 'Data Exported',

  // Therapist payments
  therapist_pay_rule_updated: 'Therapist Pay Rule Updated',
  therapist_pay_rule_deleted: 'Therapist Pay Rule Deleted',
  therapist_payout_created: 'Therapist Payout Created',
  therapist_payment_allocated: 'Therapist Payment Allocated',
  therapist_earning_recorded: 'Therapist Earning Recorded',
  therapist_payout_voided: 'Therapist Payout Voided',
  therapist_adjustment_created: 'Therapist Adjustment Created',
  therapist_adjustment_voided: 'Therapist Adjustment Voided',
  therapist_statement_exported: 'Therapist Statement Exported',

  // Insurance statement reconciliation
  insurance_statement_uploaded: 'Insurance Statement Uploaded',
  insurance_statement_posted: 'Insurance Statement Posted',
  insurance_statement_voided: 'Insurance Statement Voided',
  insurance_statement_reopened: 'Insurance Statement Re-opened',
  insurance_statement_deleted: 'Insurance Statement Deleted',
  insurance_statement_therapist_assigned: 'Insurance Statement Therapist Assigned',
} satisfies Record<AuditAction, string>;

// Fallback: turn any unmapped snake_case action into Title Case words.
function humanizeAction(action: string): string {
  return action
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function actionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action] || humanizeAction(action);
}

// Build a plain-English "what happened" description for an audit entry, pulling
// specifics (counts, changed fields, file names, status changes, etc.) out of
// the stored details JSON whenever they're available.
function describeAuditEntry(log: AuditLog): string {
  let d: any = {};
  try {
    const parsed = JSON.parse(log.details || '{}');
    if (parsed && typeof parsed === 'object') d = parsed;
  } catch {
    // details may be a plain string (legacy rows) — fall back to action-based text
  }

  const action = log.action;
  const fields: string[] | undefined = Array.isArray(d.fieldsUpdated)
    ? d.fieldsUpdated
    : Array.isArray(d.updatedFields)
    ? d.updatedFields
    : undefined;
  const statusChange =
    (d.oldStatus && d.newStatus) ? `${d.oldStatus} → ${d.newStatus}` :
    (d.previousStatus && d.newStatus) ? `${d.previousStatus} → ${d.newStatus}` :
    (d.from && d.to) ? `${d.from} → ${d.to}` : undefined;

  switch (action) {
    // Documents
    case 'document_viewed':
    case 'document_downloaded':
    case 'document_uploaded':
    case 'document_deleted':
    case 'document_approved':
    case 'document_rejected':
    case 'document_modified':
    case 'document_shared':
    case 'document_shared_in_portal':
    case 'document_unshared_from_portal': {
      const verb = actionLabel(action).replace('Document ', '').toLowerCase();
      if (d.fileName) return `${d.fileName}${d.fileType ? ` (${d.fileType})` : ''} — ${verb}`;
      return actionLabel(action);
    }

    // Notes
    case 'notes_viewed': return 'Viewed clinical notes';
    case 'note_viewed': return 'Viewed a session note';
    case 'note_ai_generated': return 'AI-generated a session note';
    case 'note_created': return 'Created a session note';
    case 'note_updated': return 'Updated a session note';
    case 'note_deleted': return 'Deleted a session note';
    case 'finalize_session_note': return 'Finalized a session note';

    // Transcripts / voice
    case 'session_transcript_viewed': return 'Viewed a session transcript';
    case 'session_transcript_created': return 'Created a session transcript';
    case 'session_transcript_smart_fill': return 'Auto-filled a note from a transcript';
    case 'session_transcript_deleted': return 'Deleted a session transcript';
    case 'voice_transcription_processed': return 'Processed a voice recording';
    case 'voice_transcription_new_note': return 'Created a note from a voice recording';
    case 'voice_transcription_failed': return `Voice transcription failed${d.reason ? `: ${d.reason}` : ''}`;
    case 'assessment_voice_transcribed': return 'Transcribed an assessment by voice';

    // Billing
    case 'billing_status_changed':
      return statusChange ? `Billing status: ${statusChange}` : 'Changed billing status';
    case 'payment_recorded':
    case 'payment_completed':
      return d.amount ? `Payment of $${d.amount}` : actionLabel(action);
    case 'invoices_viewed':
      return d.invoiceCount != null ? `Viewed ${d.invoiceCount} invoice(s)` : 'Viewed invoices';
    case 'invoice_viewed': return 'Viewed an invoice';
    case 'invoice_sent': return 'Sent an invoice';

    // Sessions / appointments
    case 'session_created': return d.session_type ? `Created session (${d.session_type})` : 'Created a session';
    case 'session_updated':
      return fields && fields.length ? `Updated session: ${fields.join(', ')}` : 'Updated a session';
    case 'session_rescheduled': return 'Rescheduled a session';
    case 'session_cancelled': return 'Cancelled a session';
    case 'session_deleted': return 'Deleted a session';
    case 'session_completed': return 'Completed a session';
    case 'session_no_show': return 'Marked a session as no-show';
    case 'session_viewed': return 'Viewed a session';
    case 'appointments_viewed':
      return d.appointmentCount != null ? `Viewed ${d.appointmentCount} appointment(s)` : 'Viewed appointments';

    // Clients
    case 'client_viewed': return 'Viewed client profile';
    case 'client_created': return 'Created a new client';
    case 'client_updated':
      return fields && fields.length ? `Updated client: ${fields.join(', ')}` : 'Updated client information';
    case 'client_deleted': return 'Deleted a client';
    case 'client_status_changed':
      return statusChange ? `Client status: ${statusChange}` : 'Changed client status';
    case 'client_assigned': return 'Assigned client to a therapist';
    case 'client_transferred': return 'Transferred client to another therapist';

    // Assessments
    case 'assessment_updated':
      return d.operation ? `Assessment: ${String(d.operation).replace(/_/g, ' ')}` : 'Updated an assessment';
    case 'assessment_completed': return 'Completed an assessment';
    case 'assessment_created': return 'Created an assessment';
    case 'assessment_viewed': return 'Viewed an assessment';
    case 'assessment_assigned': return 'Assigned an assessment';
    case 'assessment_report_generated': return 'Generated an assessment report';

    // Reports
    case 'report_generated':
    case 'client_report_generated':
      return d.method === 'ai_generated' || d.aiModel ? 'Generated a report using AI' : 'Generated a report';
    case 'client_report_finalized': return 'Finalized a client report';
    case 'client_report_reopened': return 'Reopened a client report';

    // Consent
    case 'consent_granted':
      return d.consentType ? `Granted consent: ${String(d.consentType).replace(/_/g, ' ')}` : 'Granted consent';
    case 'consent_withdrawn':
      return d.consentType ? `Withdrew consent: ${String(d.consentType).replace(/_/g, ' ')}` : 'Withdrew consent';
    case 'ai_processing_blocked':
      return 'AI processing blocked — client consent not granted';

    // Notifications
    case 'sms_notification_sent':
      return d.eventType ? `Sent SMS (${String(d.eventType).replace(/_/g, ' ')})` : 'Sent an SMS notification';
    case 'sms_notification_failed': return 'SMS notification failed to send';
    case 'sms_notification_blocked': return 'SMS notification blocked (no consent)';
    case 'sms_notification_skipped': return 'SMS notification skipped';
    case 'email_notification_sent':
      return d.eventType ? `Sent email (${String(d.eventType).replace(/_/g, ' ')})` : 'Sent an email notification';
    case 'email_notification_failed': return 'Email notification failed to send';
    case 'email_notification_blocked': return 'Email notification blocked';
    case 'email_notification_skipped': return 'Email notification skipped';

    // Calendar feed
    case 'calendar_feed_accessed':
      return d.eventCount != null ? `Synced calendar feed (${d.eventCount} event(s))` : 'Accessed calendar feed';
    case 'calendar_feed_token_generated': return 'Created a calendar subscription link';
    case 'calendar_feed_token_revoked': return 'Revoked a calendar subscription link';

    // Auth
    case 'login': return 'Signed in';
    case 'logout': return 'Signed out';
    case 'login_failed': return `Failed sign-in attempt${d.reason ? `: ${d.reason}` : ''}`;
    case 'password_changed': return 'Changed account password';
    case 'account_locked': return 'Account locked after failed attempts';
    case 'unauthorized_access':
      return d.reason || d.endpoint
        ? `Blocked${d.reason ? `: ${String(d.reason).replace(/_/g, ' ')}` : ''}${d.endpoint ? ` (${d.endpoint})` : ''}`
        : 'Unauthorized access attempt';

    // Data export
    case 'data_exported':
      return d.export_type ? `Exported ${String(d.export_type).replace(/_/g, ' ')}` : 'Exported data';

    default:
      if (d.fileName) return String(d.fileName);
      if (fields && fields.length) return `Updated: ${fields.join(', ')}`;
      return actionLabel(action);
  }
}

export default function HIPAAAuditPage() {
  const [filters, setFilters] = useState({
    startDate: formatDateInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    endDate: formatDateInput(new Date()),
    riskLevel: 'all',
    hipaaOnly: false,
    action: 'all',
    userId: '',
  });

  // Fetch audit logs
  const { data: auditLogs = [], isLoading } = useQuery({
    queryKey: ['/api/audit/logs', filters],
  }) as { data: AuditLog[]; isLoading: boolean };

  // Fetch audit statistics
  const { data: auditStats = { totalActivities: 0, phiAccess: 0, highRiskEvents: 0, failedAttempts: 0, userActivity: [] } } = useQuery({
    queryKey: ['/api/audit/stats', filters],
  }) as { data: { totalActivities: number; phiAccess: number; highRiskEvents: number; failedAttempts: number; userActivity: UserActivity[] } | undefined };

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getActionIcon = (action: string) => {
    if (action.includes('login')) return <UserCheck className="w-4 h-4" />;
    if (action.includes('client')) return <Eye className="w-4 h-4" />;
    if (action.includes('document')) return <FileText className="w-4 h-4" />;
    if (action.includes('unauthorized')) return <AlertCircle className="w-4 h-4" />;
    return <Shield className="w-4 h-4" />;
  };

  const exportAuditReport = () => {
    // This would trigger a download of the audit report
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && value !== false) {
        params.append(key, String(value));
      }
    });
    window.open(`/api/audit/export?${params.toString()}`, '_blank');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading audit logs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center">
              <Shield className="w-8 h-8 mr-3 text-blue-600" />
              HIPAA Audit Trail
            </h1>
            <p className="text-slate-600 mt-1">
              Complete audit log of all PHI access and system activities for compliance monitoring
            </p>
          </div>
          <Button onClick={exportAuditReport} className="flex items-center">
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Shield className="w-8 h-8 text-blue-600 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">Total Activities</p>
                  <p className="text-2xl font-bold">{auditStats?.totalActivities || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Eye className="w-8 h-8 text-green-600 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">PHI Access Events</p>
                  <p className="text-2xl font-bold">{auditStats?.phiAccess || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <AlertTriangle className="w-8 h-8 text-yellow-600 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">High Risk Events</p>
                  <p className="text-2xl font-bold">{auditStats?.highRiskEvents || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <AlertCircle className="w-8 h-8 text-red-600 mr-3" />
                <div>
                  <p className="text-sm text-slate-600">Failed Attempts</p>
                  <p className="text-2xl font-bold">{auditStats?.failedAttempts || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Filter className="w-5 h-5 mr-2" />
              Audit Filters
            </CardTitle>
            <CardDescription>
              Filter audit logs by date range, user, risk level, and activity type to track who is making changes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                />
              </div>
              
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                />
              </div>
              
              <div>
                <Label htmlFor="riskLevel">Risk Level</Label>
                <Select value={filters.riskLevel} onValueChange={(value) => setFilters({ ...filters, riskLevel: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div>
                <Label htmlFor="user">User Filter</Label>
                <Input
                  id="user"
                  type="text"
                  placeholder="Filter by username..."
                  value={filters.userId}
                  onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
                />
              </div>
              
              <div>
                <Label htmlFor="action">Action Type</Label>
                <Select value={filters.action} onValueChange={(value) => setFilters({ ...filters, action: value })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    <SelectItem value="client_viewed">Client Viewed</SelectItem>
                    <SelectItem value="document_accessed">Document Accessed</SelectItem>
                    <SelectItem value="login">Login Events</SelectItem>
                    <SelectItem value="data_exported">Data Exported</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-end">
                <Button variant="outline" className="w-full">
                  <Search className="w-4 h-4 mr-2" />
                  Apply Filters
                </Button>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="hipaaOnly"
                  checked={filters.hipaaOnly}
                  onChange={(e) => setFilters({ ...filters, hipaaOnly: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="hipaaOnly" className="text-sm">
                  PHI Access Only
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* User Activity Summary */}
        {auditStats.userActivity && auditStats.userActivity.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <UserCheck className="w-5 h-5 mr-2" />
                User Activity Summary
              </CardTitle>
              <CardDescription>
                Track who is making the most changes in the system
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {auditStats.userActivity.slice(0, 5).map((user, index) => (
                  <div key={user.username} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-sm font-semibold mr-3">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{user.username}</p>
                        <p className="text-sm text-slate-500">
                          Last activity: {formatDateDisplay(user.lastActivity)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-slate-900">{user.activityCount}</p>
                      <p className="text-sm text-slate-500">activities</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Audit Log Table */}
        <Card>
          <CardHeader>
            <CardTitle>Audit Log Entries</CardTitle>
            <CardDescription>
              Detailed log of all system activities and PHI access events
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                        No audit log entries found for the selected filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditLogs.map((log: AuditLog) => {
                      // Build a clear, human-readable "what happened" description
                      // covering every audit action type (see describeAuditEntry).
                      const detailsText = describeAuditEntry(log);

                      return (
                        <TableRow key={log.id} className="hover:bg-slate-50">
                          <TableCell className="font-mono text-sm">
                            {formatDateAudit(log.timestamp)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center">
                              <UserCheck className="w-4 h-4 mr-2 text-gray-500" />
                              <span className="font-medium">{log.username || 'System'}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center">
                              {getActionIcon(log.action)}
                              <span className="ml-2">{actionLabel(log.action)}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {log.clientName ? (
                                <div className="font-medium">{log.clientName}</div>
                              ) : log.resourceType === 'client' && log.clientId ? (
                                <div className="text-gray-500">Client ID: {log.clientId}</div>
                              ) : (
                                <div className="text-gray-400">—</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-slate-600">
                              {detailsText}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={log.result === 'success' ? 'default' : 'destructive'}>
                              {log.result}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {log.ipAddress}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}