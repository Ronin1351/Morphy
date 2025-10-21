/**
 * Health Check Endpoint
 * Provides system status and configuration validation
 */

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Only GET requests are supported'
    });
  }

  try {
    const USE_BLOB_STORAGE = process.env.NODE_ENV === 'production' || process.env.FORCE_BLOB === 'true';
    const hasBlobToken = !!(process.env.BLOB_READ_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN !== 'vercel_blob_rw_xxxxxxxxxxxxx');

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        useBlobStorage: USE_BLOB_STORAGE,
        blobTokenConfigured: hasBlobToken,
      },
      features: {
        ocrEnabled: process.env.ENABLE_OCR !== 'false',
        maxFileSize: `${process.env.MAX_FILE_SIZE_MB || '50'}MB`,
        fileRetention: `${process.env.FILE_RETENTION_HOURS || '24'}h`,
      },
      warnings: [],
      errors: []
    };

    // Check for configuration issues
    if (USE_BLOB_STORAGE && !hasBlobToken) {
      health.status = 'unhealthy';
      health.errors.push({
        code: 'BLOB_TOKEN_MISSING',
        message: 'BLOB_READ_WRITE_TOKEN is not configured',
        resolution: 'Set BLOB_READ_WRITE_TOKEN in Vercel Dashboard → Settings → Environment Variables'
      });
    }

    // Warning if using local storage in production-like environment
    if (!USE_BLOB_STORAGE && process.env.NODE_ENV !== 'development') {
      health.warnings.push({
        code: 'LOCAL_STORAGE_IN_PRODUCTION',
        message: 'Using local file storage in non-development environment',
        resolution: 'Set NODE_ENV=production and configure BLOB_READ_WRITE_TOKEN'
      });
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    return res.status(statusCode).json(health);

  } catch (error) {
    console.error('[HEALTH CHECK ERROR]', error);
    return res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: {
        message: 'Health check failed',
        details: error.message
      }
    });
  }
}
