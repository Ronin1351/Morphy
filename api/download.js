/**
 * GET /api/download/[id]
 * Download converted Excel/CSV file
 * 
 * Returns: Binary file download
 */

import { getProcessingResult, getFile, getDownloadUrl } from './utils/storage.js';

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

    // Get processing result
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

    // Check if processing is completed
    if (result.status !== 'completed') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PROCESSING_NOT_COMPLETE',
          message: `Processing is not complete. Current status: ${result.status}`,
          status: result.status,
          progress: result.progress,
        },
      });
    }

    // Check if output file exists
    if (!result.outputFile || !result.outputFile.fileId) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'OUTPUT_FILE_NOT_FOUND',
          message: 'Output file not found',
        },
      });
    }

    // Get download method from query parameter
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = url.searchParams.get('method') || 'stream';

    if (method === 'redirect') {
      // Method 1: Redirect to direct download URL (Vercel Blob)
      return handleRedirect(res, result);
    } else {
      // Method 2: Stream file through API (default)
      return await handleStream(res, result);
    }

  } catch (error) {
    console.error('Download error:', error);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'DOWNLOAD_FAILED',
        message: 'Failed to download file',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
    });
  }
}

/**
 * Extract processing ID from request
 */
function extractProcessingId(req) {
  // Try to get from URL path: /api/download/proc_xxxxx
  const urlParts = req.url?.split('/');
  if (urlParts && urlParts.length > 0) {
    const lastPart = urlParts[urlParts.length - 1];
    // Remove query string if present
    const cleanPart = lastPart.split('?')[0];
    if (cleanPart && cleanPart.startsWith('proc_')) {
      return cleanPart;
    }
  }

  // Try to get from query parameter: /api/download?id=proc_xxxxx
  const url = new URL(req.url, `http://${req.headers.host}`);
  const queryId = url.searchParams.get('id') || url.searchParams.get('processingId');
  
  if (queryId) {
    return queryId;
  }

  return null;
}

/**
 * Handle download via redirect to blob storage URL
 */
function handleRedirect(res, result) {
  try {
    const downloadUrl = result.outputFile.url;
    
    if (!downloadUrl) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DOWNLOAD_URL_NOT_FOUND',
          message: 'Download URL not available',
        },
      });
    }

    // Redirect to direct download URL
    res.setHeader('Location', downloadUrl);
    return res.status(302).end();

  } catch (error) {
    console.error('Redirect error:', error);
    throw error;
  }
}

/**
 * Handle download via streaming file through API
 */
async function handleStream(res, result) {
  try {
    // Get file from storage
    const fileBuffer = await getFile(result.outputFile.fileId);

    if (!fileBuffer) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'File not found in storage',
        },
      });
    }

    // Determine content type based on format
    const contentType = getContentType(result.outputFile.format);
    const filename = sanitizeFilename(result.outputFile.filename);

    // Set download headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Processing-Id', result.processingId);
    res.setHeader('X-File-Size', fileBuffer.length);
    res.setHeader('X-Transaction-Count', result.summary?.totalTransactions || 0);

    // Stream file
    return res.status(200).send(fileBuffer);

  } catch (error) {
    console.error('Stream error:', error);
    throw error;
  }
}

/**
 * Get content type based on file format
 */
function getContentType(format) {
  const contentTypes = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    json: 'application/json',
  };

  return contentTypes[format] || 'application/octet-stream';
}

/**
 * Sanitize filename for download
 */
function sanitizeFilename(filename) {
  if (!filename) {
    return 'statement_export.xlsx';
  }

  // Remove any path separators and dangerous characters
  return filename
    .replace(/[\/\\]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 255); // Max filename length
}

/**
 * Get download statistics (for analytics)
 */
export async function logDownload(processingId, req) {
  try {
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'Unknown';
    
    const downloadLog = {
      processingId,
      downloadedAt: new Date().toISOString(),
      userAgent,
      ip,
    };

    // In production, you might want to store this in a database
    console.log('Download logged:', downloadLog);
    
    return downloadLog;
  } catch (error) {
    console.error('Failed to log download:', error);
    return null;
  }
}

/**
 * Generate temporary download link (expires after X hours)
 * This could be a separate endpoint: POST /api/download/[id]/link
 */
export async function generateDownloadLink(processingId, expiresInHours = 24) {
  const result = await getProcessingResult(processingId);
  
  if (!result || result.status !== 'completed') {
    return null;
  }

  // Get signed URL from storage
  const downloadUrl = await getDownloadUrl(result.outputFile.fileId);
  
  return {
    processingId,
    downloadUrl,
    filename: result.outputFile.filename,
    expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
    size: result.outputFile.size,
    format: result.outputFile.format,
  };
}

/**
 * Check if file is available for download
 */
export async function isFileAvailable(processingId) {
  const result = await getProcessingResult(processingId);
  
  if (!result) {
    return { available: false, reason: 'Processing ID not found or expired' };
  }

  if (result.status !== 'completed') {
    return { available: false, reason: 'Processing not complete', status: result.status };
  }

  if (!result.outputFile || !result.outputFile.fileId) {
    return { available: false, reason: 'Output file not found' };
  }

  return { available: true, result };
}