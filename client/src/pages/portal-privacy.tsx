import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Shield, Check, Info, ChevronDown, HelpCircle } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface PatientConsent {
  id: number;
  clientId: number;
  consentType: 'ai_processing' | 'data_sharing' | 'research_analytics' | 'marketing_communications';
  granted: boolean;
  grantedAt: string | null;
  withdrawnAt: string | null;
  consentVersion: string;
  ipAddress: string;
  userAgent: string;
  notes: string | null;
}

interface ConsentStatus {
  ai_processing: boolean;
  data_sharing: boolean;
  research_analytics: boolean;
  marketing_communications: boolean;
}

const CONSENT_VERSION = "1.0.0"; // Update when consent terms change

const consentInfo = {
  ai_processing: {
    title: "AI-Assisted Clinical Documentation",
    description: "Allow AI tools to help your therapist generate session notes and assessment reports. This helps improve the quality and efficiency of your care.",
    details: [
      "Your clinical data will be processed by OpenAI's GPT-4 to generate draft session notes and assessment interpretations",
      "All data is pseudonymized (identifying information removed) before being sent to AI services",
      "AI-generated content is always reviewed and approved by your licensed therapist before being finalized",
      "Your data is not used to train AI models and is processed according to strict privacy agreements",
      "You can withdraw this consent at any time, though it may impact the speed of documentation"
    ]
  },
  data_sharing: {
    title: "Data Sharing with Healthcare Providers",
    description: "Allow your clinical information to be shared with other healthcare providers involved in your care.",
    details: [
      "Your treatment records may be shared with referring physicians, psychiatrists, or other providers as needed for coordinated care",
      "Sharing only occurs when clinically necessary and with appropriate authorization",
      "All sharing is logged and tracked for your security",
      "You can withdraw this consent, though it may impact coordination of your care"
    ]
  },
  research_analytics: {
    title: "Anonymous Research & Quality Improvement",
    description: "Allow your de-identified data to be used for research and improving mental health services.",
    details: [
      "Your data will be completely anonymized (all identifying information removed)",
      "Aggregated data helps improve treatment approaches and clinical outcomes",
      "No individual information will ever be published or shared",
      "Participation is voluntary and does not affect your care"
    ]
  },
  marketing_communications: {
    title: "Marketing & Service Updates",
    description: "Receive updates about new services, wellness tips, and practice news.",
    details: [
      "Occasional emails about new therapy services, wellness resources, or practice updates",
      "You can opt out at any time",
      "Your clinical information is never used for marketing purposes",
      "This does not affect appointment reminders or billing communications (those will always be sent)"
    ]
  }
};

export default function PortalPrivacy() {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>({
    ai_processing: false,
    data_sharing: false,
    research_analytics: false,
    marketing_communications: false
  });
  const { toast } = useToast();

  const { data: consents, isLoading } = useQuery<PatientConsent[]>({
    queryKey: ["/api/portal/consents"],
  });

  // Update consent status based on fetched consents
  useEffect(() => {
    if (!consents) return;

    const status: ConsentStatus = {
      ai_processing: false,
      data_sharing: false,
      research_analytics: false,
      marketing_communications: false
    };

    // Get the most recent consent for each type
    consents.forEach(consent => {
      const isActive = consent.granted && !consent.withdrawnAt;
      status[consent.consentType] = isActive;
    });

    setConsentStatus(status);
  }, [consents]);

  const updateConsentMutation = useMutation({
    mutationFn: async ({ consentType, granted }: { consentType: string; granted: boolean }) => {
      return await apiRequest("/api/portal/consents", "POST", {
        consentType,
        granted,
        consentVersion: CONSENT_VERSION
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/consents"] });
      toast({
        title: variables.granted ? "Consent granted" : "Consent withdrawn",
        description: variables.granted 
          ? "Your preference has been saved. Thank you for your consent."
          : "Your consent has been withdrawn. This change is effective immediately.",
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update your consent preference. Please try again.",
      });
    }
  });

  const handleConsentToggle = async (
    consentType: keyof ConsentStatus, 
    newValue: boolean
  ) => {
    // Optimistically update UI
    setConsentStatus(prev => ({ ...prev, [consentType]: newValue }));
    
    // Update server
    updateConsentMutation.mutate({ consentType, granted: newValue });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/portal/dashboard">
              <Button variant="ghost" size="sm" data-testid="button-back-to-dashboard">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>

        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-sm text-gray-600">Loading privacy settings...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/portal/dashboard">
            <Button variant="ghost" size="sm" data-testid="button-back-to-dashboard">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Help Section */}
        <Collapsible
          open={isHelpOpen}
          onOpenChange={setIsHelpOpen}
          className="mb-6"
        >
          <Card className="border-blue-200 bg-blue-50">
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-blue-100 transition-colors rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-5 h-5 text-blue-600" />
                    <CardTitle className="text-base">Understanding Your Privacy Choices</CardTitle>
                  </div>
                  <ChevronDown className={`w-5 h-5 text-blue-600 transition-transform ${isHelpOpen ? 'rotate-180' : ''}`} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-3 pt-0">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
                  <div>
                    <p className="font-medium text-sm">Your Rights Under GDPR & HIPAA</p>
                    <p className="text-xs text-gray-600">You have the right to control how your personal health information is used. These consent preferences give you granular control over different uses of your data.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
                  <div>
                    <p className="font-medium text-sm">Withdraw Anytime</p>
                    <p className="text-xs text-gray-600">You can change any of these preferences at any time. Your changes take effect immediately and are logged for security.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
                  <div>
                    <p className="font-medium text-sm">Essential Care Not Affected</p>
                    <p className="text-xs text-gray-600">Withdrawing consent for optional features (like AI processing or research) does not affect your access to essential mental health services.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">4</div>
                  <div>
                    <p className="font-medium text-sm">Audit Trail</p>
                    <p className="text-xs text-gray-600">All consent changes are logged with timestamps and IP addresses for security and regulatory compliance.</p>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-blue-100 rounded-lg">
                  <p className="text-xs text-blue-900">
                    <strong>🔒 Your Data Protection:</strong> We are committed to protecting your privacy. All data is encrypted, access is logged, and we comply with GDPR and HIPAA regulations. For questions about data protection, contact your therapist or our privacy officer.
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Privacy Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Privacy & Consent Settings
            </CardTitle>
            <CardDescription>
              Manage how your personal health information is used. You can change these settings at any time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* AI Processing Consent */}
            <ConsentToggleItem
              type="ai_processing"
              enabled={consentStatus.ai_processing}
              onToggle={handleConsentToggle}
              info={consentInfo.ai_processing}
            />

            {/* Data Sharing Consent */}
            <ConsentToggleItem
              type="data_sharing"
              enabled={consentStatus.data_sharing}
              onToggle={handleConsentToggle}
              info={consentInfo.data_sharing}
            />

            {/* Research Analytics Consent */}
            <ConsentToggleItem
              type="research_analytics"
              enabled={consentStatus.research_analytics}
              onToggle={handleConsentToggle}
              info={consentInfo.research_analytics}
            />

            {/* Marketing Communications Consent */}
            <ConsentToggleItem
              type="marketing_communications"
              enabled={consentStatus.marketing_communications}
              onToggle={handleConsentToggle}
              info={consentInfo.marketing_communications}
            />
          </CardContent>
        </Card>

        {/* Additional Information */}
        <Card className="mt-6 border-gray-200 bg-gray-50">
          <CardHeader>
            <CardTitle className="text-sm">Data Protection Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-gray-600">
            <p><strong>Data Security:</strong> All data is encrypted in transit and at rest using industry-standard AES-256 encryption.</p>
            <p><strong>Access Logging:</strong> Every access to your records is logged with user identity, timestamp, and purpose.</p>
            <p><strong>Your Rights:</strong> You have the right to access, correct, export, or delete your personal data. Contact us to exercise these rights.</p>
            <p><strong>Data Retention:</strong> Clinical records are retained for 7 years as required by law. You may request earlier deletion with legal exceptions.</p>
            <p><strong>Questions?</strong> Contact our Privacy Officer at privacy@smarthub.com or speak with your therapist.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

interface ConsentToggleItemProps {
  type: keyof ConsentStatus;
  enabled: boolean;
  onToggle: (type: keyof ConsentStatus, value: boolean) => void;
  info: {
    title: string;
    description: string;
    details: string[];
  };
}

function ConsentToggleItem({ type, enabled, onToggle, info }: ConsentToggleItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow" data-testid={`consent-${type}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-sm">{info.title}</h3>
            {enabled && <Check className="w-4 h-4 text-green-600" />}
          </div>
          <p className="text-xs text-gray-600 mb-3">{info.description}</p>
          
          {/* Expandable details */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors mb-2"
            data-testid={`button-details-${type}`}
          >
            <Info className="w-3 h-3" />
            <span>{isExpanded ? 'Hide' : 'Show'} details</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
          
          {isExpanded && (
            <ul className="space-y-1 mb-3">
              {info.details.map((detail, idx) => (
                <li key={idx} className="text-xs text-gray-600 flex gap-2">
                  <span className="text-blue-600 flex-shrink-0">•</span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <div className="flex-shrink-0">
          <Switch
            checked={enabled}
            onCheckedChange={(value) => onToggle(type, value)}
            data-testid={`switch-${type}`}
          />
        </div>
      </div>
      
      {/* Status indicator */}
      <div className="mt-3 pt-3 border-t flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Status:</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          enabled 
            ? 'bg-green-100 text-green-800' 
            : 'bg-gray-100 text-gray-600'
        }`}>
          {enabled ? 'Consent Granted' : 'Consent Withdrawn'}
        </span>
      </div>
    </div>
  );
}
