/**
 * Local File Storage Service
 * 
 * This service replaces Replit Object Storage with local file system storage
 * for production deployment on Azure VM.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);

export interface FileStorageResult {
  success: boolean;
  error?: string;
  path?: string;
  size?: number;
}

export interface FileInfo {
  id: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: Date;
}

export class LocalFileStorage {
  private uploadDir: string;
  private maxFileSize: number;

  constructor(uploadDir: string = './uploads', maxFileSize: number = 50 * 1024 * 1024) {
    this.uploadDir = uploadDir;
    this.maxFileSize = maxFileSize;
    this.ensureUploadDir();
  }

  /**
   * Ensure upload directory exists
   */
  private async ensureUploadDir(): Promise<void> {
    try {
      await stat(this.uploadDir);
    } catch (error) {
      await mkdir(this.uploadDir, { recursive: true });
    }
  }

  /**
   * Generate unique filename
   */
  private generateFileName(originalName: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const extension = path.extname(originalName);
    const nameWithoutExt = path.basename(originalName, extension);
    const safeName = nameWithoutExt.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    return `${timestamp}-${random}-${safeName}${extension}`;
  }

  /**
   * Store file from base64 content
   */
  async storeFile(
    base64Content: string, 
    originalName: string, 
    mimeType: string,
    documentId?: number
  ): Promise<FileStorageResult> {
    try {
      // Validate file size
      const buffer = Buffer.from(base64Content, 'base64');
      if (buffer.length > this.maxFileSize) {
        return {
          success: false,
          error: `File size ${buffer.length} exceeds maximum allowed size ${this.maxFileSize}`
        };
      }

      // Generate unique filename
      const fileName = this.generateFileName(originalName);
      const filePath = path.join(this.uploadDir, fileName);

      // Ensure directory exists
      await this.ensureUploadDir();

      // Write file
      await writeFile(filePath, buffer);

      return {
        success: true,
        path: filePath,
        size: buffer.length
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Retrieve file content
   */
  async getFile(filePath: string): Promise<FileStorageResult> {
    try {
      const buffer = await readFile(filePath);
      const base64Content = buffer.toString('base64');
      
      return {
        success: true,
        path: filePath,
        size: buffer.length
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'File not found'
      };
    }
  }

  /**
   * Delete file
   */
  async deleteFile(filePath: string): Promise<FileStorageResult> {
    try {
      await unlink(filePath);
      return { success: true };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete file'
      };
    }
  }

  /**
   * Get file info
   */
  async getFileInfo(filePath: string): Promise<FileInfo | null> {
    try {
      const stats = await stat(filePath);
      const fileName = path.basename(filePath);
      
      return {
        id: fileName.split('-')[0], // Extract timestamp as ID
        originalName: fileName,
        fileName: fileName,
        mimeType: this.getMimeType(fileName),
        size: stats.size,
        path: filePath,
        createdAt: stats.birthtime
      };

    } catch (error) {
      return null;
    }
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.zip': 'application/zip',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.csv': 'text/csv'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * List all files in upload directory
   */
  async listFiles(): Promise<FileInfo[]> {
    try {
      const files = await fs.promises.readdir(this.uploadDir);
      const fileInfos: FileInfo[] = [];

      for (const file of files) {
        const filePath = path.join(this.uploadDir, file);
        const info = await this.getFileInfo(filePath);
        if (info) {
          fileInfos.push(info);
        }
      }

      return fileInfos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    } catch (error) {
      return [];
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    averageSize: number;
  }> {
    const files = await this.listFiles();
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    return {
      totalFiles: files.length,
      totalSize,
      averageSize: files.length > 0 ? totalSize / files.length : 0
    };
  }
}

// Export singleton instance
export const localFileStorage = new LocalFileStorage(
  process.env.FILE_STORAGE_PATH || './uploads',
  parseInt(process.env.MAX_FILE_SIZE || '52428800') // 50MB default
);
