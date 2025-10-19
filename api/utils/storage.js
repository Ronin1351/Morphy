/**
 * Storage Utility - File and Data Management
 * Handles file uploads, retrieval, and cleanup using Vercel Blob Storage
 * 
 * @module storage
 * 
 * FIXED VERSION with:
 * - Comprehensive error handling
 * - Detailed logging for debugging
 * - Fixed syntax errors (tabs → spaces)
 * - Validation checks
 */

import { put, del } from '@vercel/blob';
import { kv } from '@vercel/kv';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Configuration
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024; // Default 50MB
const FILE_RETENTION_MS = parseInt(process.env.FILE_RETENTION_HOURS || '24') * 60 * 60 * 1000; // Default 24h
const USE_BLOB_STORAGE = process.env.NODE_ENV === 'production' || process.env.FORCE_BLOB === 'true';
const LOCAL_STORAGE_DIR = path.join(process.cwd(), '.tmp-storage');

// Debug logging helper
function debugLog(message, data = {}) {
  console.log(`[STORAGE ${new Date().toISOString()}]`, message, JSON.stringify(data, null, 2));
}

function errorLog(message, error, data = {}) {
  console.error(`[STORAGE ERROR ${new Date().toISOString()}]`, message, {
    error: error?.message,
    stack: error?.stack,
    ...data
  });
}

/**
 * Initialize local storage directory for development
 */
async function initLocalStorage() {
  if (!USE_BLOB_STORAGE) {
    try {
      await fs.mkdir(LOCAL_STORAGE_DIR, { recursive: true });
      debugLog('Local storage directory initialized', { path: LOCAL_STORAGE_DIR });
    } catch (error) {
      errorLog('Failed to create local storage directory', error, { path: LOCAL_STORAGE_DIR });
      throw error;
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
  debugLog('Starting file upload', {
    filename: originalFilename,
    size: fileBuffer?.length,
    contentType,
    useBlobStorage: USE_BLOB_STORAGE,
    maxSize: MAX_FILE_SIZE
  });

  // Validate inputs
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    const error = new Error('Invalid file buffer provided - must be a Buffer instance');
    errorLog('Validation failed', error, { receivedType: typeof fileBuffer });
    throw error;
  }

  if (!originalFilename || typeof originalFilename !== 'string') {
    const error = new Error('Invalid filename provided');
    errorLog('Validation failed', error, { filename: originalFilename });
    throw error;
  }

  // Validate file size
  if (fileBuffer.length === 0) {
    const error = new Error('File is empty (0 bytes)');
    errorLog('Validation failed', error);
    throw error;
  }

  if (fileBuffer.length > MAX_FILE_SIZE) {
    const error = new Error(
      `File size (${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed (${MAX_FILE_SIZE / 1024 / 1024}MB)`
    );
    errorLog('File size validation failed', error, {
      actualSize: fileBuffer.length,
      maxSize: MAX_FILE_SIZE
    });
    throw error;
  }

  const fileId = randomUUID();
  const filename = `${fileId}-${sanitizeFilename(originalFilename)}`;
  const timestamp = Date.now();

  debugLog('Generated file ID and sanitized filename', { fileId, filename });

  if (USE_BLOB_STORAGE) {
    // Production: Use Vercel Blob Storage
    try {
      debugLog('Uploading to Vercel Blob Storage...', { filename });

      // Check if BLOB_READ_WRITE_TOKEN is configured
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new Error('BLOB_READ_WRITE_TOKEN environment variable is not configured. Please set it in Vercel Dashboard.');
      }

      const blob = await put(filename, fileBuffer, {
        access: 'public',
        contentType,
        addRandomSuffix: false,
      });

      debugLog('Blob upload successful', { url: blob.url, size: fileBuffer.length });

      // Store metadata in KV
      const metadata = {
        fileId,
        url: blob.url,
        filename: originalFilename,
        size: fileBuffer.length,
        contentType,
        uploadedAt: timestamp,
        expiresAt: timestamp + FILE_RETENTION_MS,
      };

      debugLog('Storing metadata in KV...', { fileId });

      try {
        await kv.set(`file_${fileId}`, metadata, {
          ex: Math.floor(FILE_RETENTION_MS / 1000)
        });
        debugLog('Metadata stored successfully in KV', { fileId });
      } catch (kvError) {
        errorLog('Failed to store metadata in KV', kvError, { fileId, metadata });
        // Attempt to clean up blob
        try {
          await del(blob.url);
          debugLog('Cleaned up blob after KV failure', { url: blob.url });
        } catch (delError) {
          errorLog('Failed to clean up blob', delError, { url: blob.url });
        }
        throw new Error(`Failed to store file metadata: ${kvError.message}`);
      }

      return {
        fileId,
        url: blob.url,
        size: fileBuffer.length,
      };

    } catch (error) {
      errorLog('Blob storage upload failed', error, {
        filename,
        size: fileBuffer.length,
        hasToken: !!process.env.BLOB_READ_WRITE_TOKEN
      });

      // Provide more helpful error message
      if (error.message.includes('BLOB_READ_WRITE_TOKEN')) {
        throw error;
      }

      throw new Error(`Failed to upload file to Blob storage: ${error.message}`);
    }

  } else {
    // Development: Use local filesystem
    debugLog('Using local filesystem storage (development mode)');
    
    await initLocalStorage();
    const filePath = path.join(LOCAL_STORAGE_DIR, filename);

    try {
      debugLog('Writing file to local filesystem', { filePath, size: fileBuffer.length });
      
      await fs.writeFile(filePath, fileBuffer);

      const metadata = {
        fileId,
        url: `/tmp/${filename}`,
        filename: originalFilename,
        size: fileBuffer.length,
        contentType,
        uploadedAt: timestamp,
        expiresAt: timestamp + FILE_RETENTION_MS,
        localPath: filePath,
      };

      debugLog('Storing metadata in KV...', { fileId });
      
      await kv.set(`file_${fileId}`, metadata, {
        ex: Math.floor(FILE_RETENTION_MS / 1000)
      });

      debugLog('Local file saved and metadata stored', { fileId, filePath });

      return {
        fileId,
        url: metadata.url,
        size: fileBuffer.length,
      };

    } catch (error) {
      errorLog('Local storage upload failed', error, {
        filePath,
        size: fileBuffer.length
      });
      
      // Try to clean up partial file
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        // Ignore cleanup errors
      }

      throw new Error(`Failed to upload file to local storage: ${error.message}`);
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
  debugLog('Retrieving file', { fileId });

  if (!fileId || typeof fileId !== 'string') {
    const error = new Error('Invalid file ID provided');
    errorLog('Validation failed', error, { fileId });
    throw error;
  }

  let metadata;
  try {
    metadata = await kv.get(`file_${fileId}`);
  } catch (error) {
    errorLog('Failed to retrieve metadata from KV', error, { fileId });
    throw new Error(`Failed to retrieve file metadata: ${error.message}`);
  }

  if (!metadata) {
    debugLog('File not found or expired', { fileId });
    throw new Error('File not found or expired');
  }

  // Check expiration
  if (Date.now() > metadata.expiresAt) {
    debugLog('File has expired', { fileId, expiresAt: new Date(metadata.expiresAt) });
    await deleteFile(fileId);
    throw new Error('File has expired');
  }

  if (USE_BLOB_STORAGE) {
    // Fetch from Vercel Blob
    try {
      debugLog('Fetching from Blob storage', { url: metadata.url });
      
      const response = await fetch(metadata.url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      debugLog('File retrieved successfully', { fileId, size: buffer.length });
      
      return buffer;

    } catch (error) {
      errorLog('Blob retrieval failed', error, { fileId, url: metadata.url });
      throw new Error(`Failed to retrieve file from Blob storage: ${error.message}`);
    }

  } else {
    // Read from local filesystem
    try {
      debugLog('Reading from local filesystem', { path: metadata.localPath });
      
      const buffer = await fs.readFile(metadata.localPath);
      debugLog('File retrieved successfully', { fileId, size: buffer.length });
      
      return buffer;

    } catch (error) {
      errorLog('Local file read failed', error, { fileId, path: metadata.localPath });
      throw new Error(`Failed to read file from local storage: ${error.message}`);
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
  debugLog('Deleting file', { fileId });

  if (!fileId) {
    debugLog('No file ID provided for deletion');
    return false;
  }

  let metadata;
  try {
    metadata = await kv.get(`file_${fileId}`);
  } catch (error) {
    errorLog('Failed to get metadata for deletion', error, { fileId });
    return false;
  }

  if (!metadata) {
    debugLog('File metadata not found', { fileId });
    return false;
  }

  if (USE_BLOB_STORAGE) {
    try {
      debugLog('Deleting from Blob storage', { url: metadata.url });
      await del(metadata.url);
      debugLog('Blob deleted successfully', { fileId });
    } catch (error) {
      errorLog('Blob deletion failed (non-fatal)', error, { fileId, url: metadata.url });
      // Continue to delete metadata even if blob deletion fails
    }

  } else {
    // Delete from local filesystem
    try {
      debugLog('Deleting from local filesystem', { path: metadata.localPath });
      await fs.unlink(metadata.localPath);
      debugLog('Local file deleted successfully', { fileId });
    } catch (error) {
      errorLog('Local file deletion failed (non-fatal)', error, { fileId, path: metadata.localPath });
      // Continue to delete metadata even if file deletion fails
    }
  }

  // Remove from KV
  try {
    await kv.del(`file_${fileId}`);
    debugLog('Metadata deleted from KV', { fileId });
    return true;
  } catch (error) {
    errorLog('Failed to delete metadata from KV', error, { fileId });
    return false;
  }
}

/**
 * Get public download URL for a file
 * 
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<string>} Public download URL
 * @throws {Error} If file not found
 */
export async function getDownloadUrl(fileId) {
  debugLog('Getting download URL', { fileId });

  const metadata = await kv.get(`file_${fileId}`);

  if (!metadata) {
    debugLog('File not found', { fileId });
    throw new Error('File not found');
  }

  if (Date.now() > metadata.expiresAt) {
    debugLog('File expired', { fileId, expiresAt: new Date(metadata.expiresAt) });
    await deleteFile(fileId);
    throw new Error('File has expired');
  }

  debugLog('Download URL retrieved', { fileId, url: metadata.url });
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
  debugLog('Storing processing result', { processingId, dataKeys: Object.keys(data) });

  try {
    const result = {
      ...data,
      storedAt: Date.now(),
      expiresAt: Date.now() + FILE_RETENTION_MS,
    };

    await kv.set(`result_${processingId}`, result, {
      ex: Math.floor(FILE_RETENTION_MS / 1000)
    });

    debugLog('Processing result stored successfully', { processingId });
  } catch (error) {
    errorLog('Failed to store processing result', error, { processingId });
    throw new Error(`Failed to store processing result: ${error.message}`);
  }
}

/**
 * Retrieve processing result data
 * 
 * @param {string} processingId - Unique processing identifier
 * @returns {Promise<Object|null>} Processing result or null if not found
 */
export async function getProcessingResult(processingId) {
  debugLog('Retrieving processing result', { processingId });

  try {
    const result = await kv.get(`result_${processingId}`);

    if (!result) {
      debugLog('Processing result not found', { processingId });
      return null;
    }

    // Check expiration
    if (Date.now() > result.expiresAt) {
      debugLog('Processing result expired', { processingId });
      await kv.del(`result_${processingId}`);
      return null;
    }

    debugLog('Processing result retrieved', { processingId, status: result.status });
    return result;

  } catch (error) {
    errorLog('Failed to retrieve processing result', error, { processingId });
    throw new Error(`Failed to retrieve processing result: ${error.message}`);
  }
}

/**
 * Get file metadata
 * 
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<Object|null>} File metadata or null if not found
 */
export async function getFileMetadata(fileId) {
  debugLog('Retrieving file metadata', { fileId });

  try {
    const metadata = await kv.get(`file_${fileId}`);
    
    if (metadata) {
      debugLog('Metadata retrieved', { fileId, filename: metadata.filename });
    } else {
      debugLog('Metadata not found', { fileId });
    }

    return metadata || null;

  } catch (error) {
    errorLog('Failed to retrieve file metadata', error, { fileId });
    return null;
  }
}

/**
 * Cleanup expired files and results
 * Note: KV handles expiration automatically with 'ex' parameter
 * 
 * @returns {Promise<number>} Number of items cleaned up
 */
export async function cleanupExpired() {
  debugLog('Cleanup called (KV handles expiration automatically)');
  return 0;
}

/**
 * Sanitize filename to prevent path traversal and invalid characters
 * 
 * @param {string} filename - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(filename) {
  const sanitized = filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100);
  
  debugLog('Filename sanitized', { original: filename, sanitized });
  return sanitized;
}

/**
 * Get storage statistics
 * 
 * @returns {Object} Storage stats
 */
export function getStorageStats() {
  const stats = {
    totalFiles: 'N/A',
    totalResults: 'N/A',
    totalSize: 'N/A',
    storageType: USE_BLOB_STORAGE ? 'vercel-blob' : 'local-filesystem',
    maxFileSize: `${MAX_FILE_SIZE / 1024 / 1024}MB`,
    retentionTime: `${FILE_RETENTION_MS / (60 * 60 * 1000)}h`,
    note: 'Statistics not available with KV storage - items tracked via individual lookups'
  };

  debugLog('Storage stats requested', stats);
  return stats;
}

// Initialize on module load
if (!USE_BLOB_STORAGE) {
  initLocalStorage().catch(error => {
    errorLog('Failed to initialize local storage on module load', error);
  });
}

// Export default object with all functions
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
