/**
 * Storage Utility - File and Data Management
 * Handles file uploads, retrieval, and cleanup using Vercel Blob Storage
 * 
 * @module storage
 */

import { put, del, head } from '@vercel/blob';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Configuration
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024; // Default 50MB
const FILE_RETENTION_MS = parseInt(process.env.FILE_RETENTION_HOURS || '24') * 60 * 60 * 1000; // Default 24h
const USE_BLOB_STORAGE = process.env.NODE_ENV === 'production' || process.env.FORCE_BLOB === 'true';
const LOCAL_STORAGE_DIR = path.join(process.cwd(), '.tmp-storage');

// In-memory cache for processing results
const processingCache = new Map();

/**
 * Initialize local storage directory for development
 */
async function initLocalStorage() {
  if (!USE_BLOB_STORAGE) {
    try {
      await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
    } catch (error) {
      console.warn('Failed to create local storage directory:', error);
    }
  }
}

/**
 * Upload a file to storage
 * 
 * @param {Buffer} fileBuffer - File content as buffer
 * @param {string} originalFilename - Original filename
 * @param {string} contentType - MIME type (default: application/pdf)
 * @returns {Promise<{fileId: string, url: string, size: number}>}
 * @throws {Error} If file is too large or upload fails
 */
export async function uploadFile(fileBuffer, originalFilename, contentType = 'application/pdf') {
  // Validate file size
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }

  const fileId = randomUUID();
  const filename = `${fileId}-${sanitizeFilename(originalFilename)}`;
  const timestamp = Date.now();

  if (USE_BLOB_STORAGE) {
    // Production: Use Vercel Blob Storage
    try {
      const blob = await put(filename, fileBuffer, {
        access: 'public',
        contentType,
        addRandomSuffix: false,
      });

      // Store metadata
      processingCache.set(fileId, {
        fileId,
        url: blob.url,
        filename: originalFilename,
        size: fileBuffer.length,
        uploadedAt: timestamp,
        expiresAt: timestamp + FILE_RETENTION_MS,
      });

      return {
        fileId,
        url: blob.url,
        size: fileBuffer.length,
      };
    } catch (error) {
      console.error('Blob storage upload failed:', error);
      throw new Error('Failed to upload file to storage');
    }
  } else {
    // Development: Use local filesystem
    await initLocalStorage();
    const filePath = path.join(LOCAL_STORAGE_DIR, filename);

    try {
      await fs.writeFile(filePath, fileBuffer);

      const metadata = {
        fileId,
        url: `/tmp/${filename}`,
        filename: originalFilename,
        size: fileBuffer.length,
        uploadedAt: timestamp,
        expiresAt: timestamp + FILE_RETENTION_MS,
        localPath: filePath,
      };

      processingCache.set(fileId, metadata);

      return {
        fileId,
        url: metadata.url,
        size: fileBuffer.length,
      };
    } catch (error) {
      console.error('Local storage upload failed:', error);
      throw new Error('Failed to upload file to local storage');
    }
  }
}

/**
 * Retrieve file from storage
 * 
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<Buffer>} File content as buffer
 * @throws {Error} If file not found or retrieval fails
 */
export async function getFile(fileId) {
  const metadata = processingCache.get(fileId);

  if (!metadata) {
    throw new Error('File not found or expired');
  }

  // Check expiration
  if (Date.now() > metadata.expiresAt) {
    await deleteFile(fileId);
    throw new Error('File has expired');
  }

  if (USE_BLOB_STORAGE) {
    // Fetch from Vercel Blob
    try {
      const response = await fetch(metadata.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.error('Blob retrieval failed:', error);
      throw new Error('Failed to retrieve file from storage');
    }
  } else {
    // Read from local filesystem
    try {
      return await fs.readFile(metadata.localPath);
    } catch (error) {
      console.error('Local file read failed:', error);
      throw new Error('Failed to read file from local storage');
    }
  }
}

/**
 * Delete file from storage
 * 
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<boolean>} Success status
 */
export async function deleteFile(fileId) {
  const metadata = processingCache.get(fileId);

  if (!metadata) {
    return false;
  }

  if (USE_BLOB_STORAGE) {
    try {
      await del(metadata.url);
    } catch (error) {
      console.warn('Blob deletion failed:', error);
    }
  } else {
    // Delete from local filesystem
    try {
      await fs.unlink(metadata.localPath);
    } catch (error) {
      console.warn('Local file deletion failed:', error);
    }
  }

  // Remove from cache
  processingCache.delete(fileId);
  return true;
}

/**
 * Get public download URL for a file
 * 
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<string>} Public download URL
 * @throws {Error} If file not found
 */
export async function getDownloadUrl(fileId) {
  const metadata = processingCache.get(fileId);

  if (!metadata) {
    throw new Error('File not found');
  }

  if (Date.now() > metadata.expiresAt) {
    await deleteFile(fileId);
    throw new Error('File has expired');
  }

  return metadata.url;
}

/**
 * Store processing result data
 * 
 * @param {string} processingId - Unique processing identifier
 * @param {Object} data - Processing result data
 * @returns {Promise<void>}
 */
export async function storeProcessingResult(processingId, data) {
  processingCache.set(`result_${processingId}`, {
    ...data,
    storedAt: Date.now(),
    expiresAt: Date.now() + FILE_RETENTION_MS,
  });
}

/**
 * Retrieve processing result data
 * 
 * @param {string} processingId - Unique processing identifier
 * @returns {Promise<Object|null>} Processing result or null if not found
 */
export async function getProcessingResult(processingId) {
  const result = processingCache.get(`result_${processingId}`);

  if (!result) {
    return null;
  }

  // Check expiration
  if (Date.now() > result.expiresAt) {
    processingCache.delete(`result_${processingId}`);
    return null;
  }

  return result;
}

/**
 * Get file metadata
 * 
 * @param {string} fileId - Unique file identifier
 * @returns {Object|null} File metadata or null if not found
 */
export function getFileMetadata(fileId) {
  return processingCache.get(fileId) || null;
}

/**
 * Cleanup expired files and results
 * Called periodically to free up storage
 * 
 * @returns {Promise<number>} Number of items cleaned up
 */
export async function cleanupExpired() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, metadata] of processingCache.entries()) {
    if (now > metadata.expiresAt) {
      if (key.startsWith('result_')) {
        processingCache.delete(key);
      } else {
        await deleteFile(key);
      }
      cleanedCount++;
    }
  }

  return cleanedCount;
}

/**
 * Sanitize filename to prevent path traversal and invalid characters
 * 
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100);
}

/**
 * Get storage statistics
 * 
 * @returns {Object} Storage stats
 */
export function getStorageStats() {
  const files = [];
  const results = [];

  for (const [key, metadata] of processingCache.entries()) {
    if (key.startsWith('result_')) {
      results.push(metadata);
    } else {
      files.push(metadata);
    }
  }

  return {
    totalFiles: files.length,
    totalResults: results.length,
    totalSize: files.reduce((sum, f) => sum + (f.size || 0), 0),
    storageType: USE_BLOB_STORAGE ? 'vercel-blob' : 'local-filesystem',
  };
}

// Initialize on module load
if (!USE_BLOB_STORAGE) {
  initLocalStorage().catch(console.error);
}

export default {
  uploadFile,
  getFile,
  deleteFile,
  getDownloadUrl,
  storeProcessingResult,
  getProcessingResult,
  getFileMetadata,
  cleanupExpired,
  getStorageStats,
};