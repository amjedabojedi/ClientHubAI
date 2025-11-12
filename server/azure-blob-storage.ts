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
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
    if (!this.isConfigured || !this.containerClient) {
      return {
        success: false,
        error: 'Azure Blob Storage not configured'
      };
    }
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
    if (!this.isConfigured || !this.containerClient) {
      throw new Error('Azure Blob Storage not configured');
    }
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
    if (!this.isConfigured || !this.containerClient) {
      return [];
    }
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
    if (!this.isConfigured || !this.containerClient) {
      return null;
    }
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
    if (!this.isConfigured || !this.containerClient) {
      return false;
    }
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.getProperties();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Find blob by trying multiple name variations
   * This helps handle cases where blob names might differ from database fileName
   */
  async findBlobName(documentId: number, fileName: string, originalName?: string): Promise<string | null> {
    if (!this.isConfigured || !this.containerClient) {
      return null;
    }

    // Try different variations of the blob name
    const variations = [
      `documents/${documentId}-${fileName}`, // Standard format
      `documents/${documentId}-${originalName || fileName}`, // Using original name
      `documents/${documentId}-${fileName.replace(/_/g, ' ')}`, // Replace underscores with spaces
      `documents/${documentId}-${fileName.replace(/ /g, '_')}`, // Replace spaces with underscores
    ];

    // Remove duplicates
    const uniqueVariations = Array.from(new Set(variations));

    for (const blobName of uniqueVariations) {
      if (await this.fileExists(blobName)) {
        return blobName;
      }
    }

    // If not found, try to search for blobs starting with the document ID
    try {
      const prefix = `documents/${documentId}-`;
      for await (const blob of this.containerClient.listBlobsFlat({ prefix })) {
        // Return the first blob that matches (could be refined further)
        return blob.name;
      }
    } catch (error) {
      // Ignore search errors
    }

    return null;
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    containerName: string;
  }> {
    if (!this.isConfigured || !this.containerClient) {
      return {
        totalFiles: 0,
        totalSize: 0,
        containerName: this.containerName
      };
    }
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
