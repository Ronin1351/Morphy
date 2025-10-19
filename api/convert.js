/**
 * POST /api/convert
 * Main conversion endpoint - Orchestrates PDF to Excel conversion
 * 
 * Accepts: multipart/form-data with PDF file
 * Returns: Processing ID and status
 */

import formidable from 'formidable';
import { uploadFile, storeProcessingResult } from './utils/storage.js';
import { validateFile } from './utils/validator.js';
import { parsePDF } from './utils/pdf-parser.js';
import { extractTransactions } from './utils/transaction-extractor.js';
import { generateOutput } from './utils/excel-generator.js';
import { randomUUID } from 'crypto';

// Configuration
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024;
const PROCESSING_TIMEOUT = parseInt(process.env.PROCESSING_TIMEOUT_MS || '60000');

/**
 * Serverless function handler
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle OPTIONS request (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST method is allowed',
      },
    });
  }

  const processingId = `proc_${randomUUID()}`;
  const startTime = Date.now();

  try {
    // Parse multipart form data
    const { file, fields } = await parseFormData(req);

    if (!file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE_PROVIDED',
          message: 'No PDF file was uploaded',
        },
      });
    }

    // Extract options from form fields
    const options = {
      bankFormat: fields.bank_name?.[0] || null,
      format: fields.format?.[0] || 'xlsx',
      includeSummary: fields.include_summary?.[0] !== 'false',
      includeLog: fields.include_log?.[0] !== 'false',
      validateOnly: fields.validate_only?.[0] === 'true',
    };

    // Initialize processing result
    const processingResult = {
      processingId,
      status: 'processing',
      startedAt: new Date().toISOString(),
      sourceFile: file.originalFilename,
      options,
      steps: [],
    };

    // Store initial processing status
    await storeProcessingResult(processingId, processingResult);

    // Return immediate response with processing ID
	const fileBuffer = await readFileBuffer(file);
    res.status(202).json({
      success: true,
      processingId,
      status: 'processing',
      message: 'File upload received. Processing started.',
      estimatedTime: 5, // seconds
      statusUrl: `/api/status/${processingId}`,
    });

    // Continue processing asynchronously
    await processFileAsync(processingId, fileBuffer, file.originalFilename, options, startTime);
    

  } catch (error) {
    console.error('Request handling error:', error);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'REQUEST_FAILED',
        message: 'Failed to process request',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
    });
  }
}

/**
 * Parse multipart form data
 */
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
        return;
      }

      // Get the uploaded file
      const file = files.file?.[0] || files.pdf?.[0];
      
      resolve({ file, fields });
    });
  });
}

/**
 * Process file asynchronously
 */
async function processFileAsync(processingId, fileBuffer, originalFilename, options, startTime) {
  const result = {
    processingId,
    status: 'processing',
    progress: 0,
    startedAt: new Date(startTime).toISOString(),
    sourceFile: originalFilename,
    steps: [],
    errors: [],
    warnings: [],
  };

  try {
    // Step 1: Read file
    // updateProgress(processingId, result, 10, 'Reading file...');
    // const fileBuffer = await readFileBuffer(file);

    // Step 2: Validate file
    updateProgress(processingId, result, 10, 'Validating file...');
	const validation = validateFile(fileBuffer, originalFilename, 'application/pdf');
    
    if (!validation.valid) {
      result.status = 'error';
      result.errors = validation.errors;
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return;
    }

    result.steps.push({
      step: 'validation',
      status: 'completed',
      timestamp: new Date().toISOString(),
    });

    // Step 3: Upload to storage
    updateProgress(processingId, result, 20, 'Uploading file...');
	const uploadResult = await uploadFile(fileBuffer, originalFilename);
    result.fileId = uploadResult.fileId;

    result.steps.push({
      step: 'upload',
      status: 'completed',
      fileId: uploadResult.fileId,
      timestamp: new Date().toISOString(),
    });

    // If validate_only, stop here
    if (options.validateOnly) {
      result.status = 'completed';
      result.progress = 100;
      result.message = 'Validation completed successfully';
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return;
    }

    // Step 4: Parse PDF
    updateProgress(processingId, result, 40, 'Parsing PDF...');
    const parseResult = await parsePDF(fileBuffer);
    
    if (!parseResult.success) {
      result.status = 'error';
      result.errors = parseResult.errors;
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return;
    }

    result.steps.push({
      step: 'pdf_parsing',
      status: 'completed',
      metadata: parseResult.metadata,
      timestamp: new Date().toISOString(),
    });

    if (parseResult.warnings.length > 0) {
      result.warnings.push(...parseResult.warnings);
    }

    // Step 5: Extract transactions
    updateProgress(processingId, result, 60, 'Extracting transactions...');
    const extractionResult = await extractTransactions(parseResult.text, {
      bankFormat: options.bankFormat,
      metadata: parseResult.metadata,
    });

    if (!extractionResult.success) {
      result.status = 'error';
      result.errors = extractionResult.errors;
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return;
    }

    result.steps.push({
      step: 'transaction_extraction',
      status: 'completed',
      transactionsFound: extractionResult.totalTransactions,
      validTransactions: extractionResult.validTransactions,
      timestamp: new Date().toISOString(),
    });

    if (extractionResult.warnings.length > 0) {
      result.warnings.push(...extractionResult.warnings);
    }

    if (extractionResult.errors.length > 0) {
      result.errors.push(...extractionResult.errors);
    }

    // Step 6: Generate Excel
    updateProgress(processingId, result, 80, 'Generating Excel file...');
    const excelResult = await generateOutput(extractionResult, {
      format: options.format,
      filename: originalFilename.replace(/\.pdf$/i, `.${options.format}`),
      includeSummary: options.includeSummary,
      includeLog: options.includeLog,
      sourceFilename: originalFilename,
    });

    if (!excelResult.success) {
      result.status = 'error';
      result.errors.push(...excelResult.errors);
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return;
    }

    result.steps.push({
      step: 'excel_generation',
      status: 'completed',
      outputFileId: excelResult.fileId,
      timestamp: new Date().toISOString(),
    });

    // Step 7: Complete
    updateProgress(processingId, result, 100, 'Processing completed');
    result.status = 'completed';
    result.outputFile = {
      fileId: excelResult.fileId,
      filename: excelResult.filename,
      url: excelResult.url,
      size: excelResult.size,
      format: options.format,
    };
    result.summary = {
      totalTransactions: extractionResult.totalTransactions,
      validTransactions: extractionResult.validTransactions,
      invalidTransactions: extractionResult.invalidTransactions,
      openingBalance: extractionResult.openingBalance,
      closingBalance: extractionResult.closingBalance,
      totalDebits: extractionResult.totalDebits,
      totalCredits: extractionResult.totalCredits,
      bankFormat: extractionResult.bankFormat?.bankName || 'Unknown',
    };
    result.completedAt = new Date().toISOString();
    result.processingTime = Date.now() - startTime;

    await storeProcessingResult(processingId, result);

  } catch (error) {
    console.error('Processing error:', error);
    
    result.status = 'error';
    result.progress = 0;
    result.errors.push({
      code: 'PROCESSING_FAILED',
      message: 'An error occurred during processing',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    result.completedAt = new Date().toISOString();
    
    await storeProcessingResult(processingId, result);
  }
}

/**
 * Update processing progress
 */
async function updateProgress(processingId, result, progress, message) {
  result.progress = progress;
  result.currentStep = message;
  await storeProcessingResult(processingId, result);
}

/**
 * Read file buffer from uploaded file
 */
async function readFileBuffer(file) {
  const fs = await import('fs/promises');
  return await fs.readFile(file.filepath);
}

/**
 * Helper: Create error response
 */
function errorResponse(code, message, statusCode = 400, details = null) {
  return {
    success: false,
    error: {
      code,
      message,
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    },
  };
}

/**
 * Helper: Timeout promise
 */
function timeoutPromise(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Processing timeout')), ms)
    ),
  ]);
}
