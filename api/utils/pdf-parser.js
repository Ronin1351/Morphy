/**
 * PDF Parser Utility - Extract text and structured data from PDF files
 * Handles native text PDFs and scanned documents with OCR
 * 
 * @module pdf-parser
 */

import pdfParse from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import { validateFile } from './validator.js';
import { extractTransactions } from './transaction-extractor.js';

// Configuration
const ENABLE_OCR = process.env.ENABLE_OCR === 'true';
const OCR_LANGUAGE = process.env.OCR_LANGUAGE || 'eng';
const OCR_CONFIDENCE_THRESHOLD = parseInt(process.env.OCR_CONFIDENCE_THRESHOLD || '60');
const PROCESSING_TIMEOUT = parseInt(process.env.PROCESSING_TIMEOUT_MS || '60000');

/**
 * PDF parsing result structure
 */
class PDFParseResult {
  constructor() {
    this.success = false;
    this.text = '';
    this.pages = [];
    this.metadata = {};
    this.tables = [];
    this.transactions = [];
    this.isScanned = false;
    this.ocrUsed = false;
    this.confidence = 100;
    this.errors = [];
    this.warnings = [];
  }
}

/**
 * Parse PDF file and extract all content
 * 
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @param {Object} options - Parsing options
 * @returns {Promise<PDFParseResult>}
 */
export async function parsePDF(pdfBuffer, options = {}) {
  const result = new PDFParseResult();
  const startTime = Date.now();

  try {
    // Validate file first
    const validation = validateFile(pdfBuffer, 'document.pdf', 'application/pdf');
    if (!validation.valid) {
      result.errors = validation.errors;
      return result;
    }

    // Extract text using pdf-parse
    const data = await pdfParse(pdfBuffer, {
      max: options.maxPages || 100,
      version: 'v2.0.550',
    });

    // Store metadata
    result.metadata = {
      numPages: data.numpages,
      info: data.info || {},
      version: data.version,
      processingTime: Date.now() - startTime,
    };

    // Check if PDF contains actual text or is scanned
    const textLength = data.text.trim().length;
    const estimatedTextPerPage = textLength / data.numpages;

    // If very little text, likely a scanned PDF
    if (estimatedTextPerPage < 50) {
      result.isScanned = true;
      result.warnings.push({
        code: 'LOW_TEXT_CONTENT',
        message: 'PDF appears to be scanned. Text extraction may be incomplete.',
        context: { textPerPage: estimatedTextPerPage },
      });

      // Attempt OCR if enabled
      if (ENABLE_OCR) {
        result.warnings.push({
          code: 'OCR_ATTEMPTED',
          message: 'Attempting OCR extraction for scanned PDF',
        });

        const ocrResult = await performOCR(pdfBuffer, options);
        if (ocrResult.success) {
          result.text = ocrResult.text;
          result.pages = ocrResult.pages;
          result.ocrUsed = true;
          result.confidence = ocrResult.confidence;
        } else {
          result.errors.push({
            code: 'OCR_FAILED',
            message: 'OCR extraction failed',
            details: ocrResult.error,
          });
        }
      } else {
        result.warnings.push({
          code: 'OCR_DISABLED',
          message: 'OCR is disabled. Enable with ENABLE_OCR=true',
        });
      }
    } else {
      // Native text extraction successful
      result.text = data.text;
      result.pages = extractPages(data.text, data.numpages);
    }

    // Attempt to detect and extract tables
    result.tables = detectTables(result.text);

    // Extract account information and date ranges
    result.metadata.accountInfo = extractAccountInfo(result.text);
    result.metadata.statementPeriod = extractStatementPeriod(result.text);

    // Extract transactions from the text
    try {
      const transactionResult = await extractTransactions(result.text, {
        bankFormat: options,
      });

      if (transactionResult.success) {
        result.transactions = transactionResult.transactions;

        // Merge metadata
        if (transactionResult.metadata) {
          result.metadata.transactionExtraction = transactionResult.metadata;
        }

        // Add balance information
        if (transactionResult.openingBalance !== null) {
          result.metadata.openingBalance = transactionResult.openingBalance;
        }
        if (transactionResult.closingBalance !== null) {
          result.metadata.closingBalance = transactionResult.closingBalance;
        }

        // Merge warnings and errors
        if (transactionResult.warnings.length > 0) {
          result.warnings.push(...transactionResult.warnings.map(w => ({
            code: w.code || 'TRANSACTION_WARNING',
            message: w.message || w,
            context: w.context || {},
          })));
        }
        if (transactionResult.errors.length > 0) {
          result.errors.push(...transactionResult.errors.map(e => ({
            code: e.code || 'TRANSACTION_ERROR',
            message: e.message || e,
            details: e.details || {},
          })));
        }
      } else {
        result.warnings.push({
          code: 'NO_TRANSACTIONS_FOUND',
          message: 'Could not extract transactions from PDF',
          context: { errors: transactionResult.errors },
        });
      }
    } catch (transactionError) {
      result.warnings.push({
        code: 'TRANSACTION_EXTRACTION_FAILED',
        message: 'Failed to extract transactions',
        details: transactionError.message,
      });
    }

    result.success = true;
    result.metadata.processingTime = Date.now() - startTime;

  } catch (error) {
    result.success = false;
    result.errors.push({
      code: 'PARSING_FAILED',
      message: 'Failed to parse PDF',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }

  return result;
}

/**
 * Perform OCR on scanned PDF
 * 
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {Object} options - OCR options
 * @returns {Promise<Object>}
 */
async function performOCR(pdfBuffer, options = {}) {
  const result = {
    success: false,
    text: '',
    pages: [],
    confidence: 0,
    error: null,
  };

  if (!ENABLE_OCR) {
    result.error = 'OCR is not enabled';
    return result;
  }

  try {
    // Note: OCR requires converting PDF to images first
    // This is a simplified implementation
    // In production, you'd use pdf-to-image library first

    const worker = await createWorker(OCR_LANGUAGE, 1, {
      logger: process.env.NODE_ENV === 'development' ? console.log : undefined,
    });

    // For now, we'll skip actual OCR implementation
    // TODO: Implement PDF to image conversion and OCR
    result.error = 'OCR implementation requires pdf-to-image conversion';

    await worker.terminate();

  } catch (error) {
    result.error = error.message;
  }

  return result;
}

/**
 * Extract individual pages from text
 * 
 * @param {string} text - Full PDF text
 * @param {number} numPages - Number of pages
 * @returns {Array<Object>}
 */
function extractPages(text, numPages) {
  const pages = [];
  
  // Split text by common page break indicators
  const pageBreaks = [
    /Page \d+ of \d+/gi,
    /\f/g, // Form feed character
    /[\r\n]{3,}/g, // Multiple line breaks
  ];

  let pageTexts = [text];
  
  // Try to split by page break patterns
  for (const pattern of pageBreaks) {
    if (pattern.test(text)) {
      pageTexts = text.split(pattern).filter(t => t.trim().length > 0);
      break;
    }
  }

  // If we couldn't detect page breaks, estimate by text length
  if (pageTexts.length === 1 && numPages > 1) {
    const charsPerPage = Math.ceil(text.length / numPages);
    pageTexts = [];
    for (let i = 0; i < numPages; i++) {
      const start = i * charsPerPage;
      const end = Math.min((i + 1) * charsPerPage, text.length);
      pageTexts.push(text.substring(start, end));
    }
  }

  pageTexts.forEach((pageText, index) => {
    pages.push({
      pageNumber: index + 1,
      text: pageText.trim(),
      lineCount: pageText.split('\n').length,
      charCount: pageText.length,
    });
  });

  return pages;
}

/**
 * Detect tables in text using heuristics
 * 
 * @param {string} text - PDF text content
 * @returns {Array<Object>}
 */
function detectTables(text) {
  const tables = [];
  const lines = text.split('\n');

  let currentTable = null;
  let tableStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) {
      if (currentTable && currentTable.rows.length > 0) {
        tables.push(currentTable);
        currentTable = null;
      }
      continue;
    }

    // Detect potential table rows (multiple columns separated by spaces)
    const columns = line.split(/\s{2,}/).filter(col => col.trim().length > 0);
    
    // Heuristic: A table row typically has 3+ columns
    if (columns.length >= 3) {
      if (!currentTable) {
        currentTable = {
          startLine: i,
          endLine: i,
          rows: [],
          columnCount: columns.length,
        };
        tableStartIndex = i;
      }

      currentTable.rows.push({
        lineNumber: i + 1,
        columns: columns,
        rawText: line,
      });
      currentTable.endLine = i;
    } else {
      // End of table
      if (currentTable && currentTable.rows.length >= 3) {
        tables.push(currentTable);
        currentTable = null;
      }
    }
  }

  // Add last table if exists
  if (currentTable && currentTable.rows.length >= 3) {
    tables.push(currentTable);
  }

  return tables;
}

/**
 * Extract account information from PDF text
 * 
 * @param {string} text - PDF text content
 * @returns {Object}
 */
function extractAccountInfo(text) {
  const info = {
    accountNumber: null,
    accountHolder: null,
    bankName: null,
    branch: null,
  };

  // Account number patterns
  const accountPatterns = [
    /Account\s*(?:Number|No\.?|#)?\s*:?\s*(\d{4,20})/i,
    /A\/C\s*(?:No\.?|Number)?\s*:?\s*(\d{4,20})/i,
    /Account:\s*(\d{4,20})/i,
  ];

  for (const pattern of accountPatterns) {
    const match = text.match(pattern);
    if (match) {
      info.accountNumber = match[1];
      break;
    }
  }

  // Account holder patterns
  const holderPatterns = [
    /Account\s*Holder\s*:?\s*([A-Z][a-zA-Z\s.]{3,50})/i,
    /Name\s*:?\s*([A-Z][a-zA-Z\s.]{3,50})/i,
  ];

  for (const pattern of holderPatterns) {
    const match = text.match(pattern);
    if (match) {
      info.accountHolder = match[1].trim();
      break;
    }
  }

  // Bank name detection
  const bankPatterns = [
    /(?:Bank|Banking)\s*:?\s*([A-Z][a-zA-Z\s&]{3,30})/i,
  ];

  for (const pattern of bankPatterns) {
    const match = text.match(pattern);
    if (match) {
      info.bankName = match[1].trim();
      break;
    }
  }

  return info;
}

/**
 * Extract statement period (date range) from PDF text
 * 
 * @param {string} text - PDF text content
 * @returns {Object}
 */
function extractStatementPeriod(text) {
  const period = {
    from: null,
    to: null,
    raw: null,
  };

  // Statement period patterns
  const periodPatterns = [
    /Statement\s*Period\s*:?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s*(?:to|-|–)\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /From\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s*[Tt]o\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /Period:\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s*-\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
  ];

  for (const pattern of periodPatterns) {
    const match = text.match(pattern);
    if (match) {
      period.from = match[1];
      period.to = match[2];
      period.raw = match[0];
      break;
    }
  }

  return period;
}

/**
 * Extract text from specific page
 * 
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {number} pageNumber - Page number (1-indexed)
 * @returns {Promise<string>}
 */
export async function extractPageText(pdfBuffer, pageNumber) {
  try {
    const data = await pdfParse(pdfBuffer, {
      max: pageNumber,
    });

    const result = await parsePDF(pdfBuffer);
    
    if (result.success && result.pages[pageNumber - 1]) {
      return result.pages[pageNumber - 1].text;
    }

    return '';
  } catch (error) {
    console.error('Failed to extract page text:', error);
    return '';
  }
}

/**
 * Get PDF metadata only (fast, no text extraction)
 * 
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<Object>}
 */
export async function getPDFMetadata(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer, {
      max: 0, // Don't extract text
    });

    return {
      numPages: data.numpages,
      info: data.info || {},
      version: data.version,
    };
  } catch (error) {
    console.error('Failed to extract metadata:', error);
    return null;
  }
}

/**
 * Check if PDF is text-based or scanned
 * 
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<Object>}
 */
export async function detectPDFType(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer, {
      max: 1, // Only check first page
    });

    const textLength = data.text.trim().length;
    const isTextBased = textLength > 50;

    return {
      isTextBased,
      isScanned: !isTextBased,
      textLength,
      confidence: isTextBased ? 'high' : 'low',
    };
  } catch (error) {
    return {
      isTextBased: false,
      isScanned: true,
      textLength: 0,
      confidence: 'unknown',
      error: error.message,
    };
  }
}

/**
 * Extract raw text without processing
 * 
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Promise<string>}
 */
export async function extractRawText(pdfBuffer) {
  try {
    const data = await pdfParse(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error('Failed to extract raw text:', error);
    return '';
  }
}

/**
 * Search for text pattern in PDF
 * 
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {RegExp|string} pattern - Search pattern
 * @returns {Promise<Array>}
 */
export async function searchInPDF(pdfBuffer, pattern) {
  try {
    const text = await extractRawText(pdfBuffer);
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'gi') : pattern;
    const matches = [];
    let match;

    while ((match = regex.exec(text)) !== null) {
      matches.push({
        match: match[0],
        index: match.index,
        groups: match.slice(1),
      });
    }

    return matches;
  } catch (error) {
    console.error('Search failed:', error);
    return [];
  }
}

export default {
  parsePDF,
  extractPageText,
  getPDFMetadata,
  detectPDFType,
  extractRawText,
  searchInPDF,
  PDFParseResult,
};