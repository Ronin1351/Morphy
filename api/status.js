/**
 * GET /api/status/[id]
 * Get processing status for a conversion job
 * 
 * Returns: Current processing status, progress, and results
 */

import { getProcessingResult, getFileMetadata } from './utils/storage.js';

/**
 * Serverless function handler
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle OPTIONS request (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET method is allowed',
      },
    });
  }

  try {
    // Extract processing ID from URL
    // URL format: /api/status/proc_xxxxx or /api/status?id=proc_xxxxx
    const processingId = extractProcessingId(req);

    if (!processingId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PROCESSING_ID',
          message: 'Processing ID is required',
        },
      });
    }

    // Validate processing ID format
    if (!processingId.startsWith('proc_')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PROCESSING_ID',
          message: 'Invalid processing ID format',
        },
      });
    }

    // Get processing result from storage
    const result = await getProcessingResult(processingId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Processing ID not found or expired',
          processingId,
        },
      });
    }

    // Build response based on status
    const response = buildStatusResponse(result);

    // Set cache headers based on status
    if (result.status === 'completed' || result.status === 'error') {
      // Cache completed/error results for 1 hour
      res.setHeader('Cache-Control', 'public, max-age=3600');
    } else {
      // Don't cache in-progress results
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    return res.status(200).json(response);

  } catch (error) {
    console.error('Status check error:', error);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_CHECK_FAILED',
        message: 'Failed to retrieve processing status',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
    });
  }
}

/**
 * Extract processing ID from request
 * Supports both path parameter and query parameter
 */
function extractProcessingId(req) {
  // Try to get from URL path: /api/status/proc_xxxxx
  const urlParts = req.url?.split('/');
  if (urlParts && urlParts.length > 0) {
    const lastPart = urlParts[urlParts.length - 1];
    // Remove query string if present
    const cleanPart = lastPart.split('?')[0];
    if (cleanPart && cleanPart.startsWith('proc_')) {
      return cleanPart;
    }
  }

  // Try to get from query parameter: /api/status?id=proc_xxxxx
  const url = new URL(req.url, `http://${req.headers.host}`);
  const queryId = url.searchParams.get('id') || url.searchParams.get('processingId');
  
  if (queryId) {
    return queryId;
  }

  return null;
}

/**
 * Build status response based on processing result
 */
function buildStatusResponse(result) {
  const baseResponse = {
    success: true,
    processingId: result.processingId,
    status: result.status,
    progress: result.progress || 0,
    startedAt: result.startedAt,
    currentStep: result.currentStep || null,
  };

  // Add status-specific information
  switch (result.status) {
    case 'processing':
      return {
        ...baseResponse,
        message: result.currentStep || 'Processing in progress...',
        estimatedTimeRemaining: estimateTimeRemaining(result),
        steps: result.steps || [],
      };

    case 'completed':
      return {
        ...baseResponse,
        message: 'Processing completed successfully',
        completedAt: result.completedAt,
        processingTime: result.processingTime,
        outputFile: result.outputFile || null,
        summary: result.summary || null,
        downloadUrl: result.outputFile ? `/api/download/${result.processingId}` : null,
        directDownloadUrl: result.outputFile?.url || null,
        warnings: result.warnings || [],
        steps: result.steps || [],
      };

    case 'error':
      return {
        ...baseResponse,
        message: 'Processing failed',
        completedAt: result.completedAt,
        errors: result.errors || [],
        warnings: result.warnings || [],
        steps: result.steps || [],
        failedAt: result.currentStep || 'Unknown step',
      };

    case 'cancelled':
      return {
        ...baseResponse,
        message: 'Processing was cancelled',
        cancelledAt: result.completedAt,
        steps: result.steps || [],
      };

    default:
      return {
        ...baseResponse,
        message: 'Unknown status',
      };
  }
}

/**
 * Estimate remaining time based on progress
 */
function estimateTimeRemaining(result) {
  if (!result.startedAt || result.progress === 0) {
    return null;
  }

  const startTime = new Date(result.startedAt).getTime();
  const now = Date.now();
  const elapsed = now - startTime;
  
  const progressPercent = result.progress / 100;
  if (progressPercent === 0) {
    return null;
  }

  const estimatedTotal = elapsed / progressPercent;
  const remaining = Math.max(0, estimatedTotal - elapsed);

  return Math.ceil(remaining / 1000); // Return seconds
}

/**
 * Get detailed status (admin/debug endpoint)
 * Could be a separate endpoint: GET /api/status/[id]/detailed
 */
export async function getDetailedStatus(processingId) {
  const result = await getProcessingResult(processingId);
  
  if (!result) {
    return null;
  }

  // Add file metadata if available
  if (result.fileId) {
    const fileMetadata = getFileMetadata(result.fileId);
    if (fileMetadata) {
      result.fileMetadata = {
        filename: fileMetadata.filename,
        size: fileMetadata.size,
        uploadedAt: fileMetadata.uploadedAt,
        expiresAt: fileMetadata.expiresAt,
      };
    }
  }

  // Add output file metadata if available
  if (result.outputFile?.fileId) {
    const outputMetadata = getFileMetadata(result.outputFile.fileId);
    if (outputMetadata) {
      result.outputFile.metadata = {
        size: outputMetadata.size,
        uploadedAt: outputMetadata.uploadedAt,
        expiresAt: outputMetadata.expiresAt,
      };
    }
  }

  return result;
}

/**
 * Helper: Check if processing is still active
 */
export function isProcessingActive(result) {
  if (!result) return false;
  return result.status === 'processing';
}

/**
 * Helper: Check if processing is complete
 */
export function isProcessingComplete(result) {
  if (!result) return false;
  return result.status === 'completed' || result.status === 'error' || result.status === 'cancelled';
}

/**
 * Helper: Get processing duration
 */
export function getProcessingDuration(result) {
  if (!result.startedAt) return null;
  
  const start = new Date(result.startedAt).getTime();
  const end = result.completedAt ? new Date(result.completedAt).getTime() : Date.now();
  
  return end - start; // milliseconds
}