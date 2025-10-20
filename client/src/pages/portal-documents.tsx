import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Upload, FileText, File, Download, Eye, X } from "lucide-react";
import { Link } from "wouter";
import { formatDateDisplay } from "@/lib/datetime";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface Document {
  id: number;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  category: string;
  createdAt: Date;
  uploadedBy?: {
    fullName: string;
  };
}

export default function PortalDocuments() {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>("insurance");
  const [isUploading, setIsUploading] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null);

  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: ["/api/portal/documents"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: {
      fileContent: string;
      fileName: string;
      originalName: string;
      fileSize: number;
      mimeType: string;
      category: string;
    }) => {
      return await apiRequest("/api/portal/upload-document", "POST", data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/portal/documents"] });
      setSelectedFile(null);
      setCategory("insurance");
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload document",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Content = e.target?.result as string;
        const base64Data = base64Content.split(',')[1]; // Remove data:*/*;base64, prefix

        const fileName = `${Date.now()}-${selectedFile.name}`;

        await uploadMutation.mutateAsync({
          fileContent: base64Data,
          fileName,
          originalName: selectedFile.name,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type,
          category,
        });

        setIsUploading(false);
      };

      reader.onerror = () => {
        toast({
          title: "Error",
          description: "Failed to read file",
          variant: "destructive",
        });
        setIsUploading(false);
      };

      reader.readAsDataURL(selectedFile);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to upload file",
        variant: "destructive",
      });
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getCategoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      insurance: 'Insurance',
      forms: 'Forms',
      uploaded: 'Uploaded',
      shared: 'Shared',
      generated: 'Generated',
    };
    return labels[cat] || cat;
  };

  const handleViewDocument = (doc: Document) => {
    // Show document in modal preview
    setPreviewDocument(doc);
  };

  const handleDownload = (docId: number, fileName: string) => {
    // Download document with proper filename
    const link = document.createElement('a');
    link.href = `/api/portal/documents/${docId}/download`;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getPreviewUrl = (doc: Document) => {
    return `/api/portal/documents/${doc.id}/download`;
  };

  const isPDF = (doc: Document) => {
    return doc.mimeType === 'application/pdf';
  };

  const isImage = (doc: Document) => {
    return doc.mimeType?.startsWith('image/');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Link href="/portal/dashboard">
              <Button variant="outline" size="sm" data-testid="button-back">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Loading documents...</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6">
          <Link href="/portal/dashboard">
            <Button variant="outline" size="sm" data-testid="button-back" className="text-xs sm:text-sm">
              <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden xs:inline">Back to </span>Dashboard
            </Button>
          </Link>
        </div>

        {/* Upload Card */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              <CardTitle>Upload Document</CardTitle>
            </div>
            <CardDescription>
              Upload insurance cards, forms, or other documents to share with your therapist
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="file-upload">Select File</Label>
              <Input
                id="file-upload"
                type="file"
                onChange={handleFileSelect}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                data-testid="input-file"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground" data-testid="text-selected-file">
                  Selected: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                </p>
              )}
            </div>

            <div className="grid w-full items-center gap-1.5">
              <Label htmlFor="category">Document Type</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category" data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="insurance">Insurance Card/Info</SelectItem>
                  <SelectItem value="forms">Consent Forms</SelectItem>
                  <SelectItem value="uploaded">Other Documents</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className="w-full sm:w-auto"
              data-testid="button-upload"
            >
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Document
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Documents List */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle>My Documents</CardTitle>
            </div>
            <CardDescription>
              Documents you've uploaded and files shared by your therapist
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!documents || documents.length === 0 ? (
              <div className="text-center py-12">
                <File className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Documents Yet</h3>
                <p className="text-muted-foreground">
                  Upload a document above to get started
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="header-name">Name</TableHead>
                      <TableHead data-testid="header-category">Category</TableHead>
                      <TableHead data-testid="header-size">Size</TableHead>
                      <TableHead data-testid="header-uploaded">Uploaded</TableHead>
                      <TableHead data-testid="header-shared-by">Shared By</TableHead>
                      <TableHead data-testid="header-actions" className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id} data-testid={`document-row-${doc.id}`}>
                        <TableCell data-testid={`text-name-${doc.id}`}>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{doc.originalName}</span>
                          </div>
                        </TableCell>
                        <TableCell data-testid={`text-category-${doc.id}`}>
                          {getCategoryLabel(doc.category)}
                        </TableCell>
                        <TableCell data-testid={`text-size-${doc.id}`}>
                          {formatFileSize(doc.fileSize)}
                        </TableCell>
                        <TableCell data-testid={`text-uploaded-${doc.id}`}>
                          {formatDateDisplay(doc.createdAt)}
                        </TableCell>
                        <TableCell data-testid={`text-shared-by-${doc.id}`}>
                          {doc.uploadedBy?.fullName || "You"}
                        </TableCell>
                        <TableCell data-testid={`cell-actions-${doc.id}`} className="text-right">
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleViewDocument(doc)}
                              data-testid={`button-view-${doc.id}`}
                              title="Preview document"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownload(doc.id, doc.originalName)}
                              data-testid={`button-download-${doc.id}`}
                              title="Download document"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Document Preview Modal */}
      <Dialog open={!!previewDocument} onOpenChange={() => setPreviewDocument(null)}>
        <DialogContent className="max-w-4xl h-[80vh]" data-testid="dialog-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{previewDocument?.originalName}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPreviewDocument(null)}
                data-testid="button-close-preview"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden h-full">
            {previewDocument && isPDF(previewDocument) && (
              <iframe
                src={getPreviewUrl(previewDocument)}
                className="w-full h-full border-0"
                title={previewDocument.originalName}
                data-testid="iframe-pdf-preview"
              />
            )}
            {previewDocument && isImage(previewDocument) && (
              <img
                src={getPreviewUrl(previewDocument)}
                alt={previewDocument.originalName}
                className="w-full h-full object-contain"
                data-testid="img-preview"
              />
            )}
            {previewDocument && !isPDF(previewDocument) && !isImage(previewDocument) && (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <FileText className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Preview Not Available</h3>
                <p className="text-muted-foreground mb-4">
                  This file type cannot be previewed in the browser.
                </p>
                <Button
                  onClick={() => previewDocument && handleDownload(previewDocument.id, previewDocument.originalName)}
                  data-testid="button-download-from-preview"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download File
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
