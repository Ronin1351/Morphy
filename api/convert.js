/**
 * Convert API Endpoint
 * Handles PDF to Excel conversion requests
 * 
 * POST /api/convert
 * - Accepts multipart/form-data with PDF file
 * - Validates file
 * - Uploads to storage
 * - Initiates conversion process
 * - Returns processing ID for status polling
 */

import formidable from 'formidable';
import fs from 'fs/promises';
import { uploadFile, storeProcessingResult } from './utils/storage.js';
import { parsePDF } from './utils/pdf-parser.js';
import { generateExcel } from './utils/excel-generator.js';
import { validateFile } from './utils/validator.js';
import { randomUUID } from 'crypto';

// Configuration
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024;

/**
 * Debug logging helper
 */
function debugLog(processingId, message, data = {}) {
  console.log(`[CONVERT ${processingId}] ${message}`, JSON.stringify(data, null, 2));
}

function errorLog(processingId, message, error, data = {}) {
  console.error(`[CONVERT ERROR ${processingId}]`, message, {
    error: error?.message,
    stack: error?.stack,
    ...data
  });
}

/**
 * Parse multipart form data
 */
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
      minFileSize: 1,
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        console.error('[CONVERT] Form parsing error:', err);
        reject(err);
      } else {
        console.log('[CONVERT] Form parsed successfully', {
          fields: Object.keys(fields),
          files: Object.keys(files)
        });
        resolve({ fields, files });
      }
    });
  });
}

/**
 * Main conversion handler
 */
export default async function handler(req, res) {
  const processingId = randomUUID();
  
  debugLog(processingId, 'Conversion request received', {
    method: req.method,
    headers: Object.keys(req.headers),
    url: req.url
  });

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    debugLog(processingId, 'Handling OPTIONS preflight request');
    res.status(200).end();
    return;
  }

  // Only accept POST
  if (req.method !== 'POST') {
    debugLog(processingId, 'Invalid method', { method: req.method });
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST requests are allowed'
      }
    });
  }

  let fileId = null;
  let filePath = null;

  try {
    // Parse form data
    debugLog(processingId, 'Parsing form data...');
    const { fields, files } = await parseFormData(req);

    // Get file from form
    const file = files.file?.[0] || files.file;
    
    if (!file) {
      debugLog(processingId, 'No file in request', { 
        filesKeys: Object.keys(files),
        files: files 
      });
      throw new Error('No file uploaded. Please select a PDF file.');
    }

    debugLog(processingId, 'File received', {
      originalFilename: file.originalFilename,
      mimetype: file.mimetype,
      size: file.size,
      filepath: file.filepath
    });

    filePath = file.filepath;

    // Read file buffer FIRST (before validation)
    debugLog(processingId, 'Reading file buffer...');
    const fileBuffer = await fs.readFile(filePath);
    
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new Error('File is empty or could not be read');
    }

    debugLog(processingId, 'File buffer read successfully', { size: fileBuffer.length });

    // Validate file with correct parameters
    debugLog(processingId, 'Validating file...');
    const validation = validateFile(fileBuffer, file.originalFilename, file.mimetype);

    if (!validation.valid) {
      debugLog(processingId, 'File validation failed', { errors: validation.errors });
      throw new Error(validation.errors[0]?.message || 'File validation failed');
    }

    // Log warnings if any
    if (validation.warnings.length > 0) {
      debugLog(processingId, 'Validation warnings', { warnings: validation.warnings });
    }

    // Upload to storage
    debugLog(processingId, 'Uploading to storage...');
    const uploadResult = await uploadFile(
      fileBuffer,
      file.originalFilename,
      file.mimetype || 'application/pdf'
    );

    fileId = uploadResult.fileId;
    debugLog(processingId, 'File uploaded successfully', { fileId, url: uploadResult.url });

    // Get conversion options from form
    const options = {
      format: fields.format?.[0] || fields.format || 'xlsx',
      bankFormat: fields.bankFormat?.[0] || fields.bankFormat || null,
      includeSummary: fields.includeSummary !== 'false',
      includeLog: fields.includeLog !== 'false',
    };

    debugLog(processingId, 'Conversion options', options);

    // Store initial processing status
    await storeProcessingResult(processingId, {
      status: 'processing',
      progress: 0,
      currentStep: 'parsing',
      fileId,
      filename: file.originalFilename,
      options,
      startedAt: Date.now(),
    });

    debugLog(processingId, 'Initial status stored, starting conversion...');

    // Start conversion process (don't await - process asynchronously)
    processConversion(processingId, fileId, fileBuffer, file.originalFilename, options)
      .catch(error => {
        errorLog(processingId, 'Background conversion failed', error);
      });

    // Return processing ID immediately
    const response = {
      success: true,
      processingId,
      fileId,
      message: 'File uploaded successfully. Conversion started.',
      pollUrl: `/api/status?id=${processingId}`
    };

    debugLog(processingId, 'Returning response to client', response);

    res.status(202).json(response);

  } catch (error) {
    errorLog(processingId, 'Conversion initiation failed', error, { fileId });

    // Update status if we have a processing ID
    if (processingId) {
      try {
        await storeProcessingResult(processingId, {
          status: 'error',
          error: {
            code: error.code || 'CONVERSION_FAILED',
            message: error.message,
          },
          failedAt: Date.now(),
        });
      } catch (statusError) {
        errorLog(processingId, 'Failed to store error status', statusError);
      }
    }

    res.status(500).json({
      success: false,
      processingId,
      error: {
        code: error.code || 'CONVERSION_FAILED',
        message: error.message || 'Conversion failed',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });

  } finally {
    // Cleanup temporary file
    if (filePath) {
      try {
        await fs.unlink(filePath);
        debugLog(processingId, 'Temporary file cleaned up', { filePath });
      } catch (error) {
        errorLog(processingId, 'Failed to cleanup temp file', error, { filePath });
      }
    }
  }
}

/**
 * Process conversion in background
 */
async function processConversion(processingId, fileId, fileBuffer, originalFilename, options) {
  try {
    debugLog(processingId, 'Background conversion started');

    // Update status: parsing
    await storeProcessingResult(processingId, {
      status: 'processing',
      progress: 10,
      currentStep: 'parsing',
      fileId,
      filename: originalFilename,
      options,
    });

    debugLog(processingId, 'Parsing PDF...');
    const parsedData = await parsePDF(fileBuffer, options.bankFormat);
    
    debugLog(processingId, 'PDF parsed successfully', {
      transactionsFound: parsedData.transactions?.length,
      tablesFound: parsedData.tables?.length
    });

    // Update status: generating
    await storeProcessingResult(processingId, {
      status: 'processing',
      progress: 60,
      currentStep: 'generating',
      fileId,
      filename: originalFilename,
      options,
      parsedData: {
        transactionCount: parsedData.transactions?.length || 0,
        tableCount: parsedData.tables?.length || 0
      }
    });

    debugLog(processingId, 'Generating Excel file...');
    const excelResult = await generateExcel(parsedData, options);

    debugLog(processingId, 'Excel generated successfully', {
      size: excelResult.buffer.length,
      sheets: excelResult.sheets?.length
    });

    // Upload result file
    debugLog(processingId, 'Uploading result file...');
    const outputFilename = originalFilename.replace(/\.pdf$/i, `.${options.format}`);
    const resultUpload = await uploadFile(
      excelResult.buffer,
      outputFilename,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    debugLog(processingId, 'Result file uploaded', { url: resultUpload.url });

    // Update status: completed
    await storeProcessingResult(processingId, {
      status: 'completed',
      progress: 100,
      currentStep: 'completed',
      fileId,
      filename: originalFilename,
      options,
      result: {
        fileId: resultUpload.fileId,
        filename: outputFilename,
        url: resultUpload.url,
        size: resultUpload.size,
        transactionCount: parsedData.transactions?.length || 0,
        tableCount: excelResult.sheets?.length || 0,
      },
      completedAt: Date.now(),
    });

    debugLog(processingId, 'Conversion completed successfully');

  } catch (error) {
    errorLog(processingId, 'Background conversion failed', error);

    await storeProcessingResult(processingId, {
      status: 'error',
      progress: 0,
      currentStep: 'failed',
      fileId,
      filename: originalFilename,
      error: {
        code: error.code || 'PROCESSING_FAILED',
        message: error.message,
        step: error.step || 'unknown'
      },
      failedAt: Date.now(),
    });
  }
}
