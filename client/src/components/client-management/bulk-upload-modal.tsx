import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// Icons
import { Upload, Download, MapPin, CheckCircle, AlertCircle, X } from "lucide-react";

// Utils
import { apiRequest } from "@/lib/queryClient";

interface BulkUploadModalProps {
  trigger?: React.ReactNode;
}

interface ParsedData {
  headers: string[];
  rows: any[][];
  mappedData: any[];
}

interface FieldMapping {
  [key: string]: string;
}

const REQUIRED_FIELDS = [
  { key: 'fullName', label: 'Full Name', required: true },
  { key: 'referenceNumber', label: 'Reference Number', required: true },
  { key: 'email', label: 'Email', required: false },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'dateOfBirth', label: 'Date of Birth', required: false },
  { key: 'gender', label: 'Gender', required: false },
  { key: 'maritalStatus', label: 'Marital Status', required: false },
  { key: 'streetAddress1', label: 'Street Address', required: false },
  { key: 'city', label: 'City', required: false },
  { key: 'province', label: 'State/Province', required: false },
  { key: 'postalCode', label: 'ZIP/Postal Code', required: false },
  { key: 'emergencyContactName', label: 'Emergency Contact Name', required: false },
  { key: 'emergencyContactPhone', label: 'Emergency Contact Phone', required: false },
  { key: 'insuranceProvider', label: 'Insurance Provider', required: false },
  { key: 'policyNumber', label: 'Policy Number', required: false },
  { key: 'clientType', label: 'Client Type', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'stage', label: 'Stage', required: false },
];

export default function BulkUploadModal({ trigger }: BulkUploadModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1); // 1: Upload, 2: Map Fields, 3: Review, 4: Results
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [results, setResults] = useState<any>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Parse Excel file
  const parseExcelFile = (file: File): Promise<ParsedData> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = (window as any).XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const jsonData = (window as any).XLSX.utils.sheet_to_json(sheet, { header: 1 });
          
          if (jsonData.length === 0) {
            reject(new Error('Excel file is empty'));
            return;
          }

          const headers = jsonData[0];
          const rows = jsonData.slice(1);
          
          resolve({
            headers,
            rows,
            mappedData: []
          });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsBinaryString(file);
    });
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    if (!selectedFile.name.match(/\.(xlsx|xls)$/)) {
      toast({
        title: "Invalid file type",
        description: "Please upload an Excel file (.xlsx or .xls)",
        variant: "destructive"
      });
      return;
    }

    setFile(selectedFile);
    
    try {
      // Load XLSX library if not already loaded
      if (!(window as any).XLSX) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        script.onload = async () => {
          const parsed = await parseExcelFile(selectedFile);
          setParsedData(parsed);
          setStep(2);
        };
        document.head.appendChild(script);
      } else {
        const parsed = await parseExcelFile(selectedFile);
        setParsedData(parsed);
        setStep(2);
      }
    } catch (error) {
      toast({
        title: "Error parsing file",
        description: error instanceof Error ? error.message : "Failed to parse Excel file",
        variant: "destructive"
      });
    }
  };

  // Apply field mapping
  const applyMapping = () => {
    if (!parsedData) return;

    const mappedData = parsedData.rows.map(row => {
      const mappedRow: any = {};
      Object.entries(fieldMapping).forEach(([dbField, excelColumn]) => {
        if (excelColumn && excelColumn !== 'skip') {
          const columnIndex = parsedData.headers.indexOf(excelColumn);
          if (columnIndex !== -1) {
            mappedRow[dbField] = row[columnIndex];
          }
        }
      });
      return mappedRow;
    });

    setParsedData({ ...parsedData, mappedData });
    setStep(3);
  };

  // Upload clients
  const uploadClientsMutation = useMutation({
    mutationFn: async (data: any[]) => {
      const response = await apiRequest("/api/clients/bulk-upload", "POST", { clients: data });
      return response;
    },
    onSuccess: (result) => {
      setResults(result);
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Bulk upload completed",
        description: `${result.successful} clients uploaded successfully`
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload clients",
        variant: "destructive"
      });
    }
  });

  // Download template
  const downloadTemplate = () => {
    const headers = REQUIRED_FIELDS.map(field => field.label);
    const sampleData = [
      'John Doe',
      'REF-2024-001',
      'john.doe@email.com',
      '555-123-4567',
      '1990-01-15',
      'male',
      'married',
      '123 Main St',
      'Seattle',
      'WA',
      '98101',
      'Jane Doe',
      '555-987-6543',
      'Blue Cross Blue Shield',
      'BC123456789',
      'individual',
      'active',
      'intake'
    ];
    
    const csvContent = "data:text/csv;charset=utf-8," + 
      headers.join(",") + "\n" + 
      sampleData.slice(0, headers.length).join(",") + "\n";
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "client_upload_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Reset modal
  const resetModal = () => {
    setStep(1);
    setFile(null);
    setParsedData(null);
    setFieldMapping({});
    setResults(null);
    setUploadProgress(0);
  };

  const defaultTrigger = (
    <Button>
      <Upload className="w-4 h-4 mr-2" />
      Bulk Upload
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      setOpen(newOpen);
      if (!newOpen) resetModal();
    }}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Bulk Client Upload
          </DialogTitle>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-6">
          {[1, 2, 3, 4].map((stepNumber) => (
            <div key={stepNumber} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                step >= stepNumber ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                {stepNumber}
              </div>
              <span className="ml-2 text-sm">
                {stepNumber === 1 && 'Upload'}
                {stepNumber === 2 && 'Map Fields'}
                {stepNumber === 3 && 'Review'}
                {stepNumber === 4 && 'Results'}
              </span>
              {stepNumber < 4 && <div className="w-8 h-px bg-gray-300 mx-4" />}
            </div>
          ))}
        </div>

        {/* Step 1: File Upload */}
        {step === 1 && (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Upload an Excel file with client data. Make sure your file includes columns for required fields like Full Name, Email, and Phone.
              </AlertDescription>
            </Alert>

            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="w-4 h-4 mr-2" />
                Download Template
              </Button>
            </div>

            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <Label htmlFor="file-upload" className="cursor-pointer">
                <span className="text-lg font-medium">Choose Excel file</span>
                <span className="block text-sm text-gray-500 mt-1">
                  Supports .xlsx and .xls files
                </span>
              </Label>
              <Input
                id="file-upload"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            {file && (
              <div className="flex items-center gap-2 p-3 bg-gray-50 rounded">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span className="text-sm font-medium">{file.name}</span>
                <Badge variant="secondary">{(file.size / 1024).toFixed(1)} KB</Badge>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Field Mapping */}
        {step === 2 && parsedData && (
          <div className="space-y-4">
            <Alert>
              <MapPin className="h-4 w-4" />
              <AlertDescription>
                Map the columns from your Excel file to the database fields. Required fields are marked with *.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {REQUIRED_FIELDS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label>
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                  <Select
                    value={fieldMapping[field.key] || ''}
                    onValueChange={(value) => 
                      setFieldMapping(prev => ({ ...prev, [field.key]: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column or skip" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Skip this field</SelectItem>
                      {parsedData.headers.map((header, index) => (
                        <SelectItem key={index} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={applyMapping} disabled={!fieldMapping.fullName || !fieldMapping.referenceNumber}>
                Continue to Review
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review Data */}
        {step === 3 && parsedData && (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Review the mapped data before uploading. Check that the information looks correct.
              </AlertDescription>
            </Alert>

            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {REQUIRED_FIELDS.filter(field => fieldMapping[field.key] && fieldMapping[field.key] !== 'skip').map((field) => (
                      <TableHead key={field.key}>{field.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedData.mappedData.slice(0, 5).map((row, index) => (
                    <TableRow key={index}>
                      {REQUIRED_FIELDS.filter(field => fieldMapping[field.key] && fieldMapping[field.key] !== 'skip').map((field) => (
                        <TableCell key={field.key}>{row[field.key] || '-'}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="text-sm text-gray-600">
              Showing first 5 rows of {parsedData.mappedData.length} total records
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                Back to Mapping
              </Button>
              <Button 
                onClick={() => uploadClientsMutation.mutate(parsedData.mappedData)}
                disabled={uploadClientsMutation.isPending}
              >
                {uploadClientsMutation.isPending ? 'Uploading...' : `Upload ${parsedData.mappedData.length} Clients`}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Results */}
        {step === 4 && results && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-green-600">Successful</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{results.successful}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-red-600">Failed</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">{results.failed}</div>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm text-gray-600">Total</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{results.total}</div>
                </CardContent>
              </Card>
            </div>

            {results.errors && results.errors.length > 0 && (
              <div className="space-y-2">
                <Label>Errors:</Label>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {results.errors.map((error: any, index: number) => (
                    <Alert key={index} variant="destructive">
                      <AlertDescription>
                        Row {error.row}: {error.message}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}