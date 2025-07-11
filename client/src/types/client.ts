export interface Client {
  id: number;
  clientId: string;
  fullName: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
  gender?: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';
  preferredLanguage?: string;
  pronouns?: string;
  
  // Address
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  
  // Emergency contact
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  
  // Status and assignment
  status: 'active' | 'inactive' | 'pending';
  stage: 'intake' | 'assessment' | 'psychotherapy';
  clientType: 'individual' | 'couple' | 'family' | 'group';
  assignedTherapistId?: number;
  
  // Portal and access
  hasPortalAccess: boolean;
  portalEmail?: string;
  
  // Referral information
  referralSource?: string;
  referralType?: string;
  referringPerson?: string;
  referralDate?: string;
  referralNotes?: string;
  
  // Insurance information
  insuranceProvider?: string;
  policyNumber?: string;
  groupNumber?: string;
  insurancePhone?: string;
  copayAmount?: string;
  deductible?: string;
  
  // Timestamps
  startDate?: string;
  lastSessionDate?: string;
  nextAppointmentDate?: string;
  createdAt: string;
  updatedAt: string;
  
  // Related data
  assignedTherapist?: {
    id: number;
    fullName: string;
    email: string;
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
