/**
 * Azure Blob Storage Service
 * 
 * This service handles all Azure Blob Storage operations for ClientHubAI
 */

import { BlobServiceClient, ContainerClient, BlockBlobClient } from '@azure/storage-blob';

export interface AzureBlobResult {
  success: boolean;
  error?: string;
  url?: string;
  size?: number;
  blobName?: string;
  data?: Buffer;
}

export interface DocumentInfo {
  id: number;
  clientId: number;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  category: string;
  uploadedById?: number;
}

export class AzureBlobStorage {
  private containerClient: ContainerClient | null = null;
  private containerName: string;
  private isConfigured: boolean = false;

  constructor(connectionString: string, containerName: string = 'documents') {
    this.containerName = containerName;
    
    // Only initialize if connection string is provided
    if (connectionString && connectionString.trim() !== '') {
      try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        this.containerClient = blobServiceClient.getContainerClient(containerName);
        this.isConfigured = true;
      } catch (error) {
        console.warn('[Azure] Failed to initialize Azure Blob Storage:', error);
        this.isConfigured = false;
      }
    } else {
      console.log('[Azure] Azure Blob Storage not configured - using local storage');
      this.isConfigured = false;
    }
  }

  /**
   * Create container if it doesn't exist
   */
  async ensureContainer(): Promise<void> {
    if (!this.isConfigured || !this.containerClient) {
      throw new Error('Azure Blob Storage not configured');
    }
    
    try {
      await this.containerClient.createIfNotExists({
        access: 'blob' // Blob-level access for security
      });
    } catch (error) {
      throw new Error(`Failed to create container: ${error}`);
    }
  }

  /**
   * Upload file to Azure Blob Storage
   */
  async uploadFile(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    documentId: number,
    metadata?: Record<string, string>
  ): Promise<AzureBlobResult> {
    if (!this.isConfigured || !this.containerClient) {
      return {
        success: false,
        error: 'Azure Blob Storage not configured'
      };
    }
    
    try {
      await this.ensureContainer();

      const blobName = `documents/${documentId}-${fileName}`;
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);

      const uploadOptions = {
        blobHTTPHeaders: {
          blobContentType: mimeType
        },
        metadata: {
          documentId: documentId.toString(),
          originalName: fileName,
          uploadedAt: new Date().toISOString(),
          ...metadata
        }
      };

      const uploadResult = await blockBlobClient.upload(fileBuffer, fileBuffer.length, uploadOptions);
      
      return {
        success: true,
        url: blockBlobClient.url,
        blobName: blobName,
        size: fileBuffer.length
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Download file from Azure Blob Storage
   */
  async downloadFile(blobName: string): Promise<AzureBlobResult> {
    if (!this.isConfigured || !this.containerClient) {
      return {
        success: false,
        error: 'Azure Blob Storage not configured'
      };
    }
    
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const downloadResult = await blockBlobClient.download();
      
      if (!downloadResult.readableStreamBody) {
        return {
          success: false,
          error: 'No content found'
        };
      }

      const chunks: Buffer[] = [];
      for await (const chunk of downloadResult.readableStreamBody) {
        chunks.push(chunk);
      }
      
      const buffer = Buffer.concat(chunks);
      
      return {
        success: true,
        size: buffer.length,
        blobName: blobName,
        data: buffer
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'File not found'
      };
    }
  }

  /**
   * Delete file from Azure Blob Storage
   */
  async deleteFile(blobName: string): Promise<AzureBlobResult> {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.delete();
      
      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete file'
      };
    }
  }

  /**
   * Get file URL for direct access
   */
  getFileUrl(blobName: string): string {
    const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
    return blockBlobClient.url;
  }

  /**
   * Generate blob name for a document
   */
  generateBlobName(documentId: number, fileName: string): string {
    return `documents/${documentId}-${fileName}`;
  }

  /**
   * List all files in the container
   */
  async listFiles(): Promise<string[]> {
    try {
      const files: string[] = [];
      for await (const blob of this.containerClient.listBlobsFlat()) {
        files.push(blob.name);
      }
      return files;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get file metadata
   */
  async getFileMetadata(blobName: string): Promise<Record<string, string> | null> {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      const properties = await blockBlobClient.getProperties();
      return properties.metadata || {};
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(blobName: string): Promise<boolean> {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.getProperties();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    containerName: string;
  }> {
    try {
      let totalFiles = 0;
      let totalSize = 0;
      
      for await (const blob of this.containerClient.listBlobsFlat()) {
        totalFiles++;
        totalSize += blob.properties.contentLength || 0;
      }
      
      return {
        totalFiles,
        totalSize,
        containerName: this.containerName
      };
    } catch (error) {
      return {
        totalFiles: 0,
        totalSize: 0,
        containerName: this.containerName
      };
    }
  }
}

// Export singleton instance
export const azureBlobStorage = new AzureBlobStorage(
  process.env.AZURE_STORAGE_CONNECTION_STRING || '',
  process.env.AZURE_BLOB_CONTAINER_NAME || 'documents'
);
