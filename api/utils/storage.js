/**
 * Storage Utility - File and Data Management
 * FIXED VERSION with comprehensive error handling and debugging
 */

import { put, del, head } from '@vercel/blob';
import { kv } from '@vercel/kv';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// Configuration
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024;
const FILE_RETENTION_MS = parseInt(process.env.FILE_RETENTION_HOURS || '24') * 60 * 60 * 1000;
const USE_BLOB_STORAGE = process.env.NODE_ENV === 'production' || process.env.FORCE_BLOB === 'true';
const LOCAL_STORAGE_DIR = path.join(process.cwd(), '.tmp-storage');
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * Debug logger
 */
function debugLog(message, data = null) {
  if (DEBUG) {
    console.log(`[STORAGE] ${new Date().toISOString()} - ${message}`, data || '');
  }
}

/**
 * Check if required environment variables are set
 */
function checkEnvironment() {
  const issues = [];
  
  if (USE_BLOB_STORAGE) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      issues.push('BLOB_READ_WRITE_TOKEN not set');
    }
  }
  
  if (!process.env.KV_REST_API_URL) {
    issues.push('KV_REST_API_URL not set');
  }
  
  if (!process.env.KV_REST_API_TOKEN) {
    issues.push('KV_REST_API_TOKEN not set');
  }
  
  if (issues.length > 0) {
    const message = `Missing environment variables: ${issues.join(', ')}`;
    debugLog('ERROR: ' + message);
    console.error('[STORAGE] Configuration Error:', message);
    return { valid: false, issues };
  }
  
  debugLog('Environment check passed', {
    useBlobStorage: USE_BLOB_STORAGE,
    hasKV: !!process.env.KV_REST_API_URL,
  });
  
  return { valid: true, issues: [] };
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
      debugLog('ERROR: Failed to create local storage directory', error);
      console.error('[STORAGE] Failed to create local storage directory:', error);
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
  debugLog('uploadFile called', {
    fileSize: fileBuffer.length,
    originalFilename,
    contentType,
    useBlob: USE_BLOB_STORAGE,
  });

  // Check environment
  const envCheck = checkEnvironment();
  if (!envCheck.valid) {
    throw new Error(`Storage configuration error: ${envCheck.issues.join(', ')}`);
  }

  // Validate file size
  if (fileBuffer.length > MAX_FILE_SIZE) {
    const errorMsg = `File size (${formatBytes(fileBuffer.length)}) exceeds maximum allowed (${formatBytes(MAX_FILE_SIZE)})`;
    debugLog('ERROR: ' + errorMsg);
    throw new Error(errorMsg);
  }

  if (fileBuffer.length === 0) {
    debugLog('ERROR: Empty file buffer');
    throw new Error('File buffer is empty');
  }

  const fileId = randomUUID();
  const filename = `${fileId}-${sanitizeFilename(originalFilename)}`;
  const timestamp = Date.now();

  if (USE_BLOB_STORAGE) {
    // Production: Use Vercel Blob Storage
    debugLog('Using Vercel Blob Storage');
    
    try {
      debugLog('Uploading to Blob...', { filename, size: fileBuffer.length });
      
      const blob = await put(filename, fileBuffer, {
        access: 'public',
        contentType,
        addRandomSuffix: false,
      });

      debugLog('Blob upload successful', { 
        url: blob.url,
        size: blob.size,
      });

      // Store metadata in KV
      const metadata = {
        fileId,
        url: blob.url,
        filename: originalFilename,
        size: fileBuffer.length,
        uploadedAt: timestamp,
        expiresAt: timestamp + FILE_RETENTION_MS,
        storageType: 'blob',
      };

      try {
        debugLog('Storing metadata in KV...', { fileId });
        await kv.set(
          `file_${fileId}`, 
          metadata,
          { ex: Math.floor(FILE_RETENTION_MS / 1000) }
        );
        debugLog('KV metadata stored successfully');
      } catch (kvError) {
        debugLog('ERROR: Failed to store metadata in KV', kvError);
        // Try to cleanup blob
        try {
          await del(blob.url);
        } catch (delError) {
          debugLog('ERROR: Failed to cleanup blob after KV error', delError);
        }
        throw new Error(`Failed to store file metadata: ${kvError.message}`);
      }

      return {
        fileId,
        url: blob.url,
        size: fileBuffer.length,
      };

    } catch (error) {
      debugLog('ERROR: Blob storage upload failed', {
        message: error.message,
        stack: error.stack,
      });
      
      if (error.message.includes('BLOB_READ_WRITE_TOKEN')) {
        throw new Error('Blob storage not configured. Please set BLOB_READ_WRITE_TOKEN environment variable.');
      }
      
      throw new Error(`Failed to upload file to storage: ${error.message}`);
    }

  } else {
    // Development: Use local filesystem
    debugLog('Using local filesystem storage');
    await initLocalStorage();
    const filePath = path.join(LOCAL_STORAGE_DIR, filename);

    try {
      debugLog('Writing file to local storage...', { filePath });
      await fs.writeFile(filePath, fileBuffer);
      debugLog('File written successfully');

      const metadata = {
        fileId,
        url: `/tmp/${filename}`,
        filename: originalFilename,
        size: fileBuffer.length,
        uploadedAt: timestamp,
        expiresAt: timestamp + FILE_RETENTION_MS,
        localPath: filePath,
        storageType: 'local',
      };

      try {
        debugLog('Storing metadata in KV...', { fileId });
        await kv.set(
          `file_${fileId}`, 
          metadata,
          { ex: Math.floor(FILE_RETENTION_MS / 1000) }
        );
        debugLog('KV metadata stored successfully');
      } catch (kvError) {
        debugLog('ERROR: Failed to store metadata in KV', kvError);
        // Try to cleanup local file
        try {
          await fs.unlink(filePath);
        } catch (unlinkError) {
          debugLog('ERROR: Failed to cleanup local file after KV error', unlinkError);
        }
        throw new Error(`Failed to store file metadata: ${kvError.message}`);
      }

      return {
        fileId,
        url: metadata.url,
        size: fileBuffer.length,
      };

    } catch (error) {
      debugLog('ERROR: Local storage upload failed', {
        message: error.message,
        stack: error.stack,
      });
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
  debugLog('getFile called', { fileId });

  try {
    const metadata = await kv.get(`file_${fileId}`);
    debugLog('Metadata retrieved from KV', { 
      found: !!metadata,
      storageType: metadata?.storageType 
    });

    if (!metadata) {
      debugLog('ERROR: File not found in KV', { fileId });
      throw new Error('File not found or expired');
    }

    // Check expiration
    if (Date.now() > metadata.expiresAt) {
      debugLog('File expired, cleaning up...', { fileId, expiresAt: metadata.expiresAt });
      await deleteFile(fileId);
      throw new Error('File has expired');
    }

    if (USE_BLOB_STORAGE) {
      // Fetch from Vercel Blob
      try {
        debugLog('Fetching from Blob...', { url: metadata.url });
        const response = await fetch(metadata.url);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText} (${response.status})`);
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        debugLog('File retrieved from Blob', { size: buffer.length });
        return buffer;

      } catch (error) {
        debugLog('ERROR: Blob retrieval failed', error);
        throw new Error(`Failed to retrieve file from storage: ${error.message}`);
      }

    } else {
      // Read from local filesystem
      try {
        debugLog('Reading from local filesystem...', { path: metadata.localPath });
        const buffer = await fs.readFile(metadata.localPath);
        debugLog('File retrieved from local storage', { size: buffer.length });
        return buffer;

      } catch (error) {
        debugLog('ERROR: Local file read failed', error);
        
        if (error.code === 'ENOENT') {
          throw new Error('File not found in local storage');
        }
        
        throw new Error(`Failed to read file from local storage: ${error.message}`);
      }
    }

  } catch (error) {
    debugLog('ERROR in getFile', error);
    throw error;
  }
}

/**
 * Delete file from storage
 * 
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<boolean>} Success status
 */
export async function deleteFile(fileId) {
  debugLog('deleteFile called', { fileId });

  try {
    const metadata = await kv.get(`file_${fileId}`);

    if (!metadata) {
      debugLog('File metadata not found, nothing to delete', { fileId });
      return false;
    }

    if (USE_BLOB_STORAGE) {
      try {
        debugLog('Deleting from Blob...', { url: metadata.url });
        await del(metadata.url);
        debugLog('Blob deleted successfully');
      } catch (error) {
        debugLog('WARNING: Blob deletion failed', error);
        console.warn('[STORAGE] Blob deletion failed:', error);
      }
    } else {
      // Delete from local filesystem
      try {
        debugLog('Deleting from local filesystem...', { path: metadata.localPath });
        await fs.unlink(metadata.localPath);
        debugLog('Local file deleted successfully');
      } catch (error) {
        debugLog('WARNING: Local file deletion failed', error);
        console.warn('[STORAGE] Local file deletion failed:', error);
      }
    }

    // Remove from KV
    try {
      await kv.del(`file_${fileId}`);
      debugLog('KV metadata deleted successfully');
    } catch (error) {
      debugLog('WARNING: KV deletion failed', error);
      console.warn('[STORAGE] KV deletion failed:', error);
    }

    return true;

  } catch (error) {
    debugLog('ERROR in deleteFile', error);
    console.error('[STORAGE] Delete file error:', error);
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
  debugLog('getDownloadUrl called', { fileId });

  const metadata = await kv.get(`file_${fileId}`);

  if (!metadata) {
    debugLog('ERROR: File not found', { fileId });
    throw new Error('File not found');
  }

  if (Date.now() > metadata.expiresAt) {
    debugLog('File expired', { fileId });
    await deleteFile(fileId);
    throw new Error('File has expired');
  }

  debugLog('Download URL retrieved', { url: metadata.url });
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
  debugLog('storeProcessingResult called', { 
    processingId,
    status: data.status,
    progress: data.progress 
  });

  try {
    const resultData = {
      ...data,
      storedAt: Date.now(),
      expiresAt: Date.now() + FILE_RETENTION_MS,
    };

    await kv.set(
      `result_${processingId}`,
      resultData,
      { ex: Math.floor(FILE_RETENTION_MS / 1000) }
    );

    debugLog('Processing result stored successfully');

  } catch (error) {
    debugLog('ERROR: Failed to store processing result', error);
    console.error('[STORAGE] Failed to store processing result:', error);
    
    if (error.message.includes('KV')) {
      throw new Error('Failed to store processing result: KV storage not configured');
    }
    
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
  debugLog('getProcessingResult called', { processingId });

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

    debugLog('Processing result retrieved', {
      status: result.status,
      progress: result.progress
    });

    return result;

  } catch (error) {
    debugLog('ERROR: Failed to get processing result', error);
    console.error('[STORAGE] Failed to get processing result:', error);
    return null;
  }
}

/**
 * Get file metadata
 * 
 * @param {string} fileId - Unique file identifier
 * @returns {Promise<Object|null>} File metadata or null if not found
 */
export async function getFileMetadata(fileId) {
  debugLog('getFileMetadata called', { fileId });

  try {
    const metadata = await kv.get(`file_${fileId}`);
    debugLog('File metadata retrieved', { found: !!metadata });
    return metadata || null;
  } catch (error) {
    debugLog('ERROR: Failed to get file metadata', error);
    console.error('[STORAGE] Failed to get file metadata:', error);
    return null;
  }
}

/**
 * Cleanup expired files and results
 * KV handles this automatically, but keeping for compatibility
 */
export async function cleanupExpired() {
  debugLog('cleanupExpired called (KV handles this automatically)');
  return 0;
}

/**
 * Get storage statistics
 */
export function getStorageStats() {
  return {
    totalFiles: 'N/A (KV auto-managed)',
    totalResults: 'N/A (KV auto-managed)',
    totalSize: 'N/A',
    storageType: USE_BLOB_STORAGE ? 'vercel-blob' : 'local-filesystem',
    kvStorage: 'vercel-kv',
    debug: DEBUG,
    environment: {
      hasBlob Token: !!process.env.BLOB_READ_WRITE_TOKEN,
      hasKVUrl: !!process.env.KV_REST_API_URL,
      hasKVToken: !!process.env.KV_REST_API_TOKEN,
      nodeEnv: process.env.NODE_ENV,
    },
  };
}

/**
 * Sanitize filename to prevent path traversal and invalid characters
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100);
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Initialize on module load
if (!USE_BLOB_STORAGE) {
  initLocalStorage().catch((error) => {
    console.error('[STORAGE] Failed to initialize local storage:', error);
  });
}

// Log configuration on startup
debugLog('Storage module initialized', {
  useBlob: USE_BLOB_STORAGE,
  maxFileSize: formatBytes(MAX_FILE_SIZE),
  retentionHours: FILE_RETENTION_MS / 1000 / 60 / 60,
});

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
  checkEnvironment,
};
