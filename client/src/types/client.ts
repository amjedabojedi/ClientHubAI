export interface Client {
  id: number;
  clientId: string;
  fullName: string;
  dateOfBirth?: string | null;
  phone?: string | null;
  email?: string | null;
  gender?: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say' | null;
  preferredLanguage?: string | null;
  pronouns?: string | null;
  maritalStatus?: string | null;
  emailNotifications?: boolean | null;
  
  // Portal Access
  hasPortalAccess?: boolean | null;
  portalEmail?: string | null;
  
  // Address
  address?: string | null;
  streetAddress1?: string | null;
  streetAddress2?: string | null;
  city?: string | null;
  state?: string | null;
  province?: string | null;
  zipCode?: string | null;
  postalCode?: string | null;
  country?: string | null;
  
  // Emergency contact
  emergencyPhone?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
  
  // Status and assignment
  status?: 'active' | 'inactive' | 'pending' | null;
  stage?: 'intake' | 'assessment' | 'psychotherapy' | null;
  clientType?: string | null;
  assignedTherapistId?: number | null;
  
  // Referral information
  referrerName?: string | null;
  referralDate?: string | null;
  referenceNumber?: string | null;
  clientSource?: string | null;
  referralSource?: string | null;
  referralType?: string | null;
  referringPerson?: string | null;
  referralNotes?: string | null;
  
  // Employment & Socioeconomic
  employmentStatus?: string | null;
  educationLevel?: string | null;
  dependents?: number | null;
  
  // Insurance information
  insuranceProvider?: string | null;
  policyNumber?: string | null;
  groupNumber?: string | null;
  insurancePhone?: string | null;
  copayAmount?: string | null;
  deductible?: string | null;
  
  // Service information
  serviceType?: string | null;
  serviceFrequency?: string | null;
  
  // Additional information
  notes?: string | null;
  
  // Follow-up Management
  needsFollowUp?: boolean | null;
  followUpPriority?: 'low' | 'medium' | 'high' | 'urgent' | null;
  followUpDate?: string | null;
  
  // Timestamps
  startDate?: string | null;
  lastSessionDate?: string | null;
  nextAppointmentDate?: string | null;
  createdAt: string;
  updatedAt: string;
  
  // Related data
  assignedTherapist?: {
    id: number;
    fullName: string;
    email: string;
    role: string;
  };
  sessionCount?: number;
  taskCount?: number;
}

export interface ClientStats {
  totalClients: number;
  activeClients: number;
  inactiveClients: number;
  newIntakes: number;
  assessmentPhase: number;
  psychotherapy: number;
  noSessions: number;
  needsFollowUp: number;
}

export interface Document {
  id: number;
  clientId: number;
  uploadedById: number;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  category: string;
  isSharedInPortal: boolean;
  downloadCount: number;
  createdAt: string;
  uploadedBy?: {
    id: number;
    fullName: string;
    email: string;
  };
}

export interface ClientsQueryResult {
  clients: Client[];
  total: number;
  totalPages: number;
}
