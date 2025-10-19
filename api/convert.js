/**
 * POST /api/convert
 * Main conversion endpoint - Orchestrates PDF to Excel conversion
 * FIXED VERSION with proper error handling and debugging
 */

import formidable from 'formidable';
import { uploadFile, storeProcessingResult } from './utils/storage.js';
import { validateFile } from './utils/validator.js';
import { parsePDF } from './utils/pdf-parser.js';
import { extractTransactions } from './utils/transaction-extractor.js';
import { generateOutput } from './utils/excel-generator.js';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';

// Configuration
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024;
const PROCESSING_TIMEOUT = parseInt(process.env.PROCESSING_TIMEOUT_MS || '300000'); // 5 minutes for Vercel Pro
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * Debug logger
 */
function debugLog(message, data = null) {
  if (DEBUG) {
    console.log(`[CONVERT] ${new Date().toISOString()} - ${message}`, data || '');
  }
}

/**
 * Serverless function handler
 */
export default async function handler(req, res) {
  const requestId = randomUUID().substring(0, 8);
  debugLog(`[${requestId}] New request received`, { method: req.method, url: req.url });

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle OPTIONS request (CORS preflight)
  if (req.method === 'OPTIONS') {
    debugLog(`[${requestId}] CORS preflight request`);
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    debugLog(`[${requestId}] Method not allowed: ${req.method}`);
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST method is allowed',
        requestId,
      },
    });
  }

  const processingId = `proc_${randomUUID()}`;
  const startTime = Date.now();
  
  debugLog(`[${requestId}] Processing ID: ${processingId}`);

  try {
    // Parse multipart form data
    debugLog(`[${requestId}] Parsing form data...`);
    const { file, fields } = await parseFormData(req);
    debugLog(`[${requestId}] Form data parsed`, { 
      hasFile: !!file, 
      fileName: file?.originalFilename,
      fileSize: file?.size,
      fields: Object.keys(fields || {})
    });

    if (!file) {
      debugLog(`[${requestId}] ERROR: No file provided`);
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE_PROVIDED',
          message: 'No PDF file was uploaded',
          requestId,
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
    
    debugLog(`[${requestId}] Options extracted`, options);

    // Initialize processing result
    const processingResult = {
      processingId,
      requestId,
      status: 'processing',
      progress: 0,
      startedAt: new Date().toISOString(),
      sourceFile: file.originalFilename,
      options,
      steps: [],
      errors: [],
      warnings: [],
    };

    // Store initial processing status
    debugLog(`[${requestId}] Storing initial processing status...`);
    await storeProcessingResult(processingId, processingResult);
    debugLog(`[${requestId}] Initial status stored`);

    // **CRITICAL FIX**: Read file buffer BEFORE processing
    debugLog(`[${requestId}] Reading file buffer from: ${file.filepath}`);
    let fileBuffer;
    try {
      fileBuffer = await fs.readFile(file.filepath);
      debugLog(`[${requestId}] File buffer read successfully`, { size: fileBuffer.length });
    } catch (readError) {
      debugLog(`[${requestId}] ERROR: Failed to read file buffer`, readError);
      throw new Error(`Failed to read uploaded file: ${readError.message}`);
    }

    // **CRITICAL FIX**: Process synchronously before sending response
    // This ensures processing completes within the serverless function execution
    debugLog(`[${requestId}] Starting synchronous processing...`);
    const result = await processFile(
      processingId, 
      fileBuffer, 
      file.originalFilename, 
      options, 
      startTime,
      requestId
    );
    
    debugLog(`[${requestId}] Processing completed`, { 
      status: result.status,
      hasOutputFile: !!result.outputFile 
    });

    // Clean up uploaded temp file
    try {
      await fs.unlink(file.filepath);
      debugLog(`[${requestId}] Temp file cleaned up`);
    } catch (cleanupError) {
      debugLog(`[${requestId}] Warning: Failed to cleanup temp file`, cleanupError);
    }

    // Return final result
    if (result.status === 'completed') {
      debugLog(`[${requestId}] Returning success response`);
      return res.status(200).json({
        success: true,
        processingId,
        status: 'completed',
        message: 'File converted successfully',
        result,
        statusUrl: `/api/status/${processingId}`,
        downloadUrl: `/api/download/${processingId}`,
        requestId,
      });
    } else {
      debugLog(`[${requestId}] Returning error response`, result.errors);
      return res.status(400).json({
        success: false,
        processingId,
        status: 'error',
        errors: result.errors,
        warnings: result.warnings,
        requestId,
      });
    }

  } catch (error) {
    debugLog(`[${requestId}] FATAL ERROR in request handler`, {
      message: error.message,
      stack: error.stack,
    });
    
    console.error(`[${requestId}] Request handling error:`, error);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'REQUEST_FAILED',
        message: 'Failed to process request',
        details: DEBUG ? error.message : 'An internal error occurred',
        stack: DEBUG ? error.stack : undefined,
        requestId,
      },
    });
  }
}

/**
 * Parse multipart form data with better error handling
 */
async function parseFormData(req) {
  return new Promise((resolve, reject) => {
    debugLog('Initializing formidable parser...');
    
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
      keepExtensions: true,
      multiples: false, // Single file only
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        debugLog('Formidable parse error', {
          message: err.message,
          code: err.code,
          httpCode: err.httpCode,
        });
        
        // Provide more specific error messages
        if (err.code === 1009) { // File size limit
          reject(new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`));
        } else {
          reject(err);
        }
        return;
      }

      debugLog('Form parsed successfully', {
        fieldKeys: Object.keys(fields),
        fileKeys: Object.keys(files),
      });

      // Get the uploaded file
      const file = files.file?.[0] || files.pdf?.[0];
      
      if (!file) {
        debugLog('No file found in upload', { files });
      }
      
      resolve({ file, fields });
    });
  });
}

/**
 * Process file synchronously (CRITICAL FIX)
 */
async function processFile(processingId, fileBuffer, originalFilename, options, startTime, requestId) {
  const result = {
    processingId,
    requestId,
    status: 'processing',
    progress: 0,
    startedAt: new Date(startTime).toISOString(),
    sourceFile: originalFilename,
    steps: [],
    errors: [],
    warnings: [],
  };

  try {
    debugLog(`[${requestId}] Step 1: Validating file...`);
    // Step 1: Validate file
    await updateProgress(processingId, result, 10, 'Validating file...');
    
    let validation;
    try {
      validation = validateFile(fileBuffer, originalFilename, 'application/pdf');
      debugLog(`[${requestId}] Validation result`, { valid: validation.valid, errorCount: validation.errors?.length });
    } catch (validateError) {
      debugLog(`[${requestId}] ERROR: Validation function failed`, validateError);
      throw new Error(`Validation error: ${validateError.message}`);
    }
    
    if (!validation.valid) {
      result.status = 'error';
      result.errors = validation.errors || [{ 
        code: 'VALIDATION_FAILED', 
        message: 'File validation failed' 
      }];
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return result;
    }

    result.steps.push({
      step: 'validation',
      status: 'completed',
      timestamp: new Date().toISOString(),
    });

    debugLog(`[${requestId}] Step 2: Uploading to storage...`);
    // Step 2: Upload to storage
    await updateProgress(processingId, result, 20, 'Uploading file...');
    
    let uploadResult;
    try {
      uploadResult = await uploadFile(fileBuffer, originalFilename);
      debugLog(`[${requestId}] Upload successful`, { fileId: uploadResult.fileId });
    } catch (uploadError) {
      debugLog(`[${requestId}] ERROR: Upload failed`, uploadError);
      throw new Error(`Upload error: ${uploadError.message}`);
    }
    
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
      return result;
    }

    debugLog(`[${requestId}] Step 3: Parsing PDF...`);
    // Step 3: Parse PDF
    await updateProgress(processingId, result, 40, 'Parsing PDF...');
    
    let parseResult;
    try {
      parseResult = await parsePDF(fileBuffer);
      debugLog(`[${requestId}] PDF parsed`, { 
        success: parseResult.success,
        textLength: parseResult.text?.length,
        pageCount: parseResult.metadata?.pageCount
      });
    } catch (parseError) {
      debugLog(`[${requestId}] ERROR: PDF parsing failed`, parseError);
      throw new Error(`PDF parsing error: ${parseError.message}`);
    }
    
    if (!parseResult.success) {
      result.status = 'error';
      result.errors = parseResult.errors || [{
        code: 'PDF_PARSE_FAILED',
        message: 'Failed to parse PDF'
      }];
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return result;
    }

    result.steps.push({
      step: 'pdf_parsing',
      status: 'completed',
      metadata: parseResult.metadata,
      timestamp: new Date().toISOString(),
    });

    if (parseResult.warnings?.length > 0) {
      result.warnings.push(...parseResult.warnings);
    }

    debugLog(`[${requestId}] Step 4: Extracting transactions...`);
    // Step 4: Extract transactions
    await updateProgress(processingId, result, 60, 'Extracting transactions...');
    
    let extractionResult;
    try {
      extractionResult = await extractTransactions(parseResult.text, {
        bankFormat: options.bankFormat,
        metadata: parseResult.metadata,
      });
      debugLog(`[${requestId}] Extraction complete`, {
        success: extractionResult.success,
        totalTransactions: extractionResult.totalTransactions
      });
    } catch (extractError) {
      debugLog(`[${requestId}] ERROR: Transaction extraction failed`, extractError);
      throw new Error(`Extraction error: ${extractError.message}`);
    }

    if (!extractionResult.success) {
      result.status = 'error';
      result.errors = extractionResult.errors || [{
        code: 'EXTRACTION_FAILED',
        message: 'Failed to extract transactions'
      }];
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return result;
    }

    result.steps.push({
      step: 'transaction_extraction',
      status: 'completed',
      transactionsFound: extractionResult.totalTransactions,
      validTransactions: extractionResult.validTransactions,
      timestamp: new Date().toISOString(),
    });

    if (extractionResult.warnings?.length > 0) {
      result.warnings.push(...extractionResult.warnings);
    }

    if (extractionResult.errors?.length > 0) {
      result.errors.push(...extractionResult.errors);
    }

    debugLog(`[${requestId}] Step 5: Generating Excel...`);
    // Step 5: Generate Excel
    await updateProgress(processingId, result, 80, 'Generating Excel file...');
    
    let excelResult;
    try {
      excelResult = await generateOutput(extractionResult, {
        format: options.format,
        filename: originalFilename.replace(/\.pdf$/i, `.${options.format}`),
        includeSummary: options.includeSummary,
        includeLog: options.includeLog,
        sourceFilename: originalFilename,
      });
      debugLog(`[${requestId}] Excel generated`, {
        success: excelResult.success,
        fileId: excelResult.fileId
      });
    } catch (excelError) {
      debugLog(`[${requestId}] ERROR: Excel generation failed`, excelError);
      throw new Error(`Excel generation error: ${excelError.message}`);
    }

    if (!excelResult.success) {
      result.status = 'error';
      result.errors.push(...(excelResult.errors || [{
        code: 'EXCEL_GENERATION_FAILED',
        message: 'Failed to generate Excel file'
      }]));
      result.completedAt = new Date().toISOString();
      await storeProcessingResult(processingId, result);
      return result;
    }

    result.steps.push({
      step: 'excel_generation',
      status: 'completed',
      outputFileId: excelResult.fileId,
      timestamp: new Date().toISOString(),
    });

    debugLog(`[${requestId}] Step 6: Finalizing...`);
    // Step 6: Complete
    await updateProgress(processingId, result, 100, 'Processing completed');
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
    debugLog(`[${requestId}] Processing complete!`, { processingTime: result.processingTime });

    return result;

  } catch (error) {
    debugLog(`[${requestId}] ERROR in processFile`, {
      message: error.message,
      stack: error.stack
    });
    
    console.error(`[${requestId}] Processing error:`, error);
    
    result.status = 'error';
    result.progress = 0;
    result.errors.push({
      code: 'PROCESSING_FAILED',
      message: error.message || 'An error occurred during processing',
      details: DEBUG ? error.stack : undefined,
    });
    result.completedAt = new Date().toISOString();
    
    await storeProcessingResult(processingId, result);
    return result;
  }
}

/**
 * Update processing progress
 */
async function updateProgress(processingId, result, progress, message) {
  result.progress = progress;
  result.currentStep = message;
  debugLog(`Progress: ${progress}% - ${message}`);
  
  try {
    await storeProcessingResult(processingId, result);
  } catch (error) {
    debugLog('WARNING: Failed to update progress', error);
    // Don't throw - this is non-critical
  }
}
