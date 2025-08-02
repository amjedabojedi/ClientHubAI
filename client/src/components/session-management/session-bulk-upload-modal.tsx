import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";

// UI Components
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Icons
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Download } from "lucide-react";

// Utils
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SessionBulkUploadModalProps {
  trigger?: React.ReactNode;
}

interface SessionUploadData {
  clientId: string;
  therapistUsername: string;
  sessionDate: string;
  sessionTime: string;
  sessionType: string;
  serviceCode: string;
  roomNumber: string;
  notes?: string;
}

interface BulkUploadResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{
    row: number;
    data: any;
    message: string;
  }>;
}

const SessionBulkUploadModal: React.FC<SessionBulkUploadModalProps> = ({ trigger }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [uploadData, setUploadData] = useState<SessionUploadData[]>([]);
  const [fieldMapping, setFieldMapping] = useState<{ [key: string]: string }>({});
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [uploadResults, setUploadResults] = useState<BulkUploadResult | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const requiredFields = [
    { key: 'clientId', label: 'Client ID', required: true },
    { key: 'therapistUsername', label: 'Therapist Username (Optional - uses assigned therapist if empty)', required: false },
    { key: 'sessionDate', label: 'Session Date (YYYY-MM-DD)', required: true },
    { key: 'sessionTime', label: 'Session Time (HH:MM)', required: true },
    { key: 'sessionType', label: 'Session Type', required: true },
    { key: 'serviceCode', label: 'Service Code', required: true },
    { key: 'roomNumber', label: 'Room Number', required: true },
    { key: 'notes', label: 'Notes (Optional)', required: false }
  ];

  const bulkUploadMutation = useMutation({
    mutationFn: (sessions: SessionUploadData[]) => 
      apiRequest('/api/sessions/bulk-upload', 'POST', { sessions }),
    onSuccess: (data: BulkUploadResult) => {
      setUploadResults(data);
      setCurrentStep(4);
      queryClient.invalidateQueries({ queryKey: ['/api/sessions'] });
      
      if (data.successful > 0) {
        toast({
          title: "Upload Complete",
          description: `Successfully uploaded ${data.successful} out of ${data.total} sessions.`,
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload sessions",
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length < 2) {
          toast({
            title: "Invalid File",
            description: "The file must contain at least a header row and one data row.",
            variant: "destructive",
          });
          return;
        }

        const headers = jsonData[0] as string[];
        const rows = jsonData.slice(1);
        
        setAvailableColumns(headers);
        
        // Convert to objects
        const sessions = rows.map((row: any) => {
          const sessionObj: any = {};
          headers.forEach((header, index) => {
            sessionObj[header] = row[index] || '';
          });
          return sessionObj;
        });
        
        setUploadData(sessions);
        setCurrentStep(2);
        
      } catch (error) {
        toast({
          title: "Error Reading File",
          description: "Failed to parse the uploaded file. Please ensure it's a valid Excel or CSV file.",
          variant: "destructive",
        });
      }
    };
    
    reader.readAsArrayBuffer(uploadedFile);
  };

  const handleFieldMapping = () => {
    // Validate that all required fields are mapped
    const missingRequired = requiredFields
      .filter(field => field.required && !fieldMapping[field.key])
      .map(field => field.label);
    
    if (missingRequired.length > 0) {
      toast({
        title: "Missing Required Fields",
        description: `Please map the following required fields: ${missingRequired.join(', ')}`,
        variant: "destructive",
      });
      return;
    }
    
    setCurrentStep(3);
  };

  const processUpload = () => {
    // Transform data based on field mapping
    const transformedData = uploadData.map(row => {
      const transformed: any = {};
      Object.entries(fieldMapping).forEach(([targetField, sourceColumn]) => {
        if (sourceColumn && row[sourceColumn] !== undefined) {
          transformed[targetField] = row[sourceColumn];
        }
      });
      return transformed;
    });
    
    bulkUploadMutation.mutate(transformedData);
  };

  const downloadTemplate = () => {
    const templateData = [
      ['Client ID', 'Therapist Username (Optional)', 'Session Date', 'Session Time', 'Session Type', 'Service Code', 'Room Number', 'Notes'],
      ['CL-2025-0001', '', '2025-08-01', '10:00', 'psychotherapy', '90834-C', '101', 'Uses assigned therapist'],
      ['CL-2025-0002', 'dr.smith', '2025-08-01', '11:00', 'assessment', '90791', '102', 'Override with specific therapist']
    ];
    
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sessions Template');
    XLSX.writeFile(workbook, 'session_upload_template.xlsx');
  };

  const resetModal = () => {
    setCurrentStep(1);
    setFile(null);
    setUploadData([]);
    setFieldMapping({});
    setAvailableColumns([]);
    setUploadResults(null);
  };

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(resetModal, 300); // Reset after modal close animation
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Upload className="w-4 h-4 mr-2" />
            Import Sessions
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Upload Sessions</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Progress Steps */}
          <div className="flex items-center justify-between">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep >= step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}>
                  {step}
                </div>
                {step < 4 && (
                  <div className={`w-16 h-1 mx-2 ${
                    currentStep > step ? 'bg-blue-600' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: File Upload */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-medium mb-2">Upload Session Data</h3>
                <p className="text-gray-600 mb-4">
                  Upload an Excel or CSV file with session information
                </p>
              </div>
              
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <FileSpreadsheet className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="max-w-xs mx-auto"
                />
              </div>
              
              <div className="flex justify-center">
                <Button variant="outline" onClick={downloadTemplate}>
                  <Download className="w-4 h-4 mr-2" />
                  Download Template
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Field Mapping */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium mb-2">Map Fields</h3>
                <p className="text-gray-600 mb-4">
                  Map your Excel columns to the required session fields
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {requiredFields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <label className="text-sm font-medium">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <Select
                      value={fieldMapping[field.key] || ''}
                      onValueChange={(value) => 
                        setFieldMapping(prev => ({ ...prev, [field.key]: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- Select Column --</SelectItem>
                        {availableColumns.map((column) => (
                          <SelectItem key={column} value={column}>
                            {column}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(1)}>
                  Back
                </Button>
                <Button onClick={handleFieldMapping}>
                  Next
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Review Data */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium mb-2">Review Data</h3>
                <p className="text-gray-600 mb-4">
                  Review the first few sessions before uploading
                </p>
              </div>
              
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600 mb-2">
                  Found {uploadData.length} sessions to upload
                </p>
                <div className="max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {requiredFields.slice(0, 4).map((field) => (
                          <th key={field.key} className="text-left p-2">
                            {field.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadData.slice(0, 5).map((session, index) => (
                        <tr key={index} className="border-b">
                          {requiredFields.slice(0, 4).map((field) => (
                            <td key={field.key} className="p-2">
                              {fieldMapping[field.key] ? session[fieldMapping[field.key]] || '-' : '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrentStep(2)}>
                  Back
                </Button>
                <Button 
                  onClick={processUpload}
                  disabled={bulkUploadMutation.isPending}
                >
                  {bulkUploadMutation.isPending ? 'Uploading...' : 'Upload Sessions'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Results */}
          {currentStep === 4 && uploadResults && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium mb-2">Upload Results</h3>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mb-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-blue-600">{uploadResults.total}</div>
                    <div className="text-sm text-gray-600">Total</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{uploadResults.successful}</div>
                    <div className="text-sm text-gray-600">Successful</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{uploadResults.failed}</div>
                    <div className="text-sm text-gray-600">Failed</div>
                  </CardContent>
                </Card>
              </div>

              {uploadResults.errors.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Errors ({uploadResults.errors.length})</h4>
                  <div className="max-h-40 overflow-y-auto space-y-2">
                    {uploadResults.errors.map((error, index) => (
                      <Alert key={index} variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          Row {error.row}: {error.message}
                        </AlertDescription>
                      </Alert>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex justify-end">
                <Button onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SessionBulkUploadModal;