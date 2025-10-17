/**
 * Transaction Extractor - Parse and extract transactions from PDF text
 * Supports multiple bank formats with configurable patterns
 * 
 * @module transaction-extractor
 */

import { validateDate, validateAmount, validateDescription } from './validator.js';
import fs from 'fs/promises';
import path from 'path';

// Load bank format configurations
let bankFormats = [];
const BANK_FORMATS_PATH = process.env.BANK_FORMATS_CONFIG || 'api/config/bank-formats.json';

/**
 * Transaction object structure
 */
class Transaction {
  constructor() {
    this.transactionId = null;
    this.date = null;
    this.valueDate = null;
    this.description = '';
    this.debit = null;
    this.credit = null;
    this.amount = null;
    this.balance = null;
    this.transactionType = null;
    this.reference = null;
    this.status = 'POSTED';
    this.notes = '';
    this.processingStatus = 'VALID';
    this.errorMessages = [];
    this.rawLine = '';
    this.lineNumber = null;
  }
}

/**
 * Extraction result structure
 */
class ExtractionResult {
  constructor() {
    this.success = false;
    this.transactions = [];
    this.bankFormat = null;
    this.totalTransactions = 0;
    this.validTransactions = 0;
    this.invalidTransactions = 0;
    this.openingBalance = null;
    this.closingBalance = null;
    this.totalDebits = 0;
    this.totalCredits = 0;
    this.errors = [];
    this.warnings = [];
    this.metadata = {};
  }
}

/**
 * Initialize bank formats from configuration file
 */
async function loadBankFormats() {
  if (bankFormats.length > 0) {
    return bankFormats;
  }

  try {
    const configPath = path.join(process.cwd(), BANK_FORMATS_PATH);
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data);
    bankFormats = config.formats || [];
    return bankFormats;
  } catch (error) {
    console.warn('Failed to load bank formats config, using defaults:', error.message);
    return getDefaultBankFormats();
  }
}

/**
 * Get default bank format patterns
 */
function getDefaultBankFormats() {
  return [
    {
      bankId: 'generic',
      bankName: 'Generic Format',
      country: 'Universal',
      patterns: {
        // Date Description Debit Credit Balance
        standard: /^(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/,
        // Date Description Amount Balance
        simple: /^(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*$/,
        // Date Description Debit/Credit Balance
        combined: /^(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s+(.+?)\s+([\d,]+\.\d{2})\s+([DC])\s+([\d,]+\.\d{2})\s*$/,
      },
      dateFormat: 'MM/DD/YYYY',
      decimalSeparator: '.',
      thousandsSeparator: ',',
      amountPosition: 'separate', // 'separate' or 'signed'
      balanceIncluded: true,
    },
    {
      bankId: 'us_bank',
      bankName: 'US Bank Format',
      country: 'US',
      patterns: {
        standard: /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,]+\.\d{2})?\s*([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})\s*$/,
      },
      dateFormat: 'MM/DD/YYYY',
      decimalSeparator: '.',
      thousandsSeparator: ',',
      amountPosition: 'separate',
      balanceIncluded: true,
    },
    {
      bankId: 'ph_bank',
      bankName: 'Philippine Bank Format',
      country: 'PH',
      patterns: {
        standard: /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,]+\.\d{2})?\s*([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})\s*$/,
        bpi: /^(\d{2}\/\d{2}\/\d{4})\s+(.{40})\s+([\d,]+\.\d{2})?\s*([\d,]+\.\d{2})?\s+([\d,]+\.\d{2})\s*$/,
      },
      dateFormat: 'MM/DD/YYYY',
      decimalSeparator: '.',
      thousandsSeparator: ',',
      amountPosition: 'separate',
      balanceIncluded: true,
    },
  ];
}

/**
 * Extract transactions from PDF text
 * 
 * @param {string} text - Parsed PDF text
 * @param {Object} options - Extraction options
 * @returns {Promise<ExtractionResult>}
 */
export async function extractTransactions(text, options = {}) {
  const result = new ExtractionResult();
  
  try {
    // Load bank formats
    const formats = await loadBankFormats();
    
    // Detect bank format
    const detectedFormat = options.bankFormat || detectBankFormat(text, formats);
    result.bankFormat = detectedFormat;
    
    if (!detectedFormat) {
      result.errors.push({
        code: 'UNKNOWN_FORMAT',
        message: 'Could not detect bank format',
      });
      return result;
    }

    // Clean and prepare text
    const lines = cleanText(text).split('\n');
    
    // Extract opening/closing balances
    const balances = extractBalances(text);
    result.openingBalance = balances.opening;
    result.closingBalance = balances.closing;

    // Extract transaction lines
    const transactions = [];
    let lineNumber = 0;

    for (const line of lines) {
      lineNumber++;
      
      // Skip empty lines and headers
      if (!line.trim() || isHeaderLine(line)) {
        continue;
      }

      // Try to match transaction patterns
      const transaction = parseTransactionLine(line, detectedFormat, lineNumber);
      
      if (transaction) {
        // Validate transaction
        const validation = validateTransaction(transaction);
        if (validation.valid) {
          transaction.processingStatus = 'VALID';
          result.validTransactions++;
        } else {
          transaction.processingStatus = validation.warnings.length > 0 ? 'WARNING' : 'ERROR';
          transaction.errorMessages = validation.errors.map(e => e.message);
          result.invalidTransactions++;
          
          if (validation.errors.length > 0) {
            result.errors.push({
              line: lineNumber,
              transaction,
              errors: validation.errors,
            });
          }
        }

        transactions.push(transaction);
      }
    }

    // Post-processing
    result.transactions = postProcessTransactions(transactions, result);
    result.totalTransactions = result.transactions.length;
    result.success = result.totalTransactions > 0;

    // Calculate totals
    result.transactions.forEach(t => {
      if (t.debit) result.totalDebits += parseFloat(t.debit);
      if (t.credit) result.totalCredits += parseFloat(t.credit);
    });

    // Metadata
    result.metadata = {
      extractedAt: new Date().toISOString(),
      linesProcessed: lineNumber,
      bankFormat: detectedFormat.bankName,
    };

  } catch (error) {
    result.success = false;
    result.errors.push({
      code: 'EXTRACTION_FAILED',
      message: 'Failed to extract transactions',
      details: error.message,
    });
  }

  return result;
}

/**
 * Detect bank format from text
 * 
 * @param {string} text - PDF text
 * @param {Array} formats - Available bank formats
 * @returns {Object|null}
 */
function detectBankFormat(text, formats) {
  const lines = text.split('\n').slice(0, 50); // Check first 50 lines
  
  for (const format of formats) {
    let matchCount = 0;
    
    for (const line of lines) {
      for (const patternName in format.patterns) {
        const pattern = format.patterns[patternName];
        if (pattern.test(line)) {
          matchCount++;
        }
      }
    }
    
    // If we find 3+ matches, it's likely this format
    if (matchCount >= 3) {
      return format;
    }
  }

  // Default to generic format
  return formats.find(f => f.bankId === 'generic') || formats[0];
}

/**
 * Parse single transaction line
 * 
 * @param {string} line - Transaction line text
 * @param {Object} format - Bank format configuration
 * @param {number} lineNumber - Line number in document
 * @returns {Transaction|null}
 */
function parseTransactionLine(line, format, lineNumber) {
  for (const patternName in format.patterns) {
    const pattern = format.patterns[patternName];
    const match = line.match(pattern);
    
    if (match) {
      const transaction = new Transaction();
      transaction.rawLine = line;
      transaction.lineNumber = lineNumber;
      transaction.transactionId = `txn_${lineNumber}_${Date.now()}`;

      // Extract based on pattern type
      if (patternName === 'standard') {
        transaction.date = normalizeDate(match[1]);
        transaction.description = match[2].trim();
        transaction.debit = match[3] ? parseAmount(match[3], format) : null;
        transaction.credit = match[4] ? parseAmount(match[4], format) : null;
        transaction.balance = match[5] ? parseAmount(match[5], format) : null;
      } else if (patternName === 'simple') {
        transaction.date = normalizeDate(match[1]);
        transaction.description = match[2].trim();
        const amount = parseAmount(match[3], format);
        // Determine if debit or credit based on description keywords
        if (isDebitTransaction(match[2])) {
          transaction.debit = amount;
        } else {
          transaction.credit = amount;
        }
        transaction.balance = match[4] ? parseAmount(match[4], format) : null;
      } else if (patternName === 'combined') {
        transaction.date = normalizeDate(match[1]);
        transaction.description = match[2].trim();
        const amount = parseAmount(match[3], format);
        const type = match[4]; // D or C
        if (type === 'D') {
          transaction.debit = amount;
        } else {
          transaction.credit = amount;
        }
        transaction.balance = match[5] ? parseAmount(match[5], format) : null;
      }

      // Calculate amount (net transaction)
      if (transaction.debit) {
        transaction.amount = -Math.abs(transaction.debit);
        transaction.transactionType = 'DEBIT';
      } else if (transaction.credit) {
        transaction.amount = Math.abs(transaction.credit);
        transaction.transactionType = 'CREDIT';
      }

      // Categorize transaction
      transaction.transactionType = categorizeTransaction(transaction.description, transaction.transactionType);

      return transaction;
    }
  }

  return null;
}

/**
 * Clean text for processing
 * 
 * @param {string} text - Raw text
 * @returns {string}
 */
function cleanText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\s{2,}/g, ' ') // Normalize multiple spaces
    .replace(/^\s+|\s+$/gm, ''); // Trim lines
}

/**
 * Check if line is a header
 * 
 * @param {string} line - Text line
 * @returns {boolean}
 */
function isHeaderLine(line) {
  const headerKeywords = [
    'Date',
    'Description',
    'Debit',
    'Credit',
    'Balance',
    'Transaction',
    'Amount',
    'Reference',
    'Page',
    'Statement',
    'Account',
  ];

  const lowerLine = line.toLowerCase();
  let keywordCount = 0;

  for (const keyword of headerKeywords) {
    if (lowerLine.includes(keyword.toLowerCase())) {
      keywordCount++;
    }
  }

  return keywordCount >= 2;
}

/**
 * Normalize date to standard format
 * 
 * @param {string} dateStr - Date string
 * @returns {string} YYYY-MM-DD format
 */
function normalizeDate(dateStr) {
  if (!dateStr) return null;

  // Try to parse various formats
  const formats = [
    // MM/DD/YYYY
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    // DD/MM/YYYY
    /^(\d{2})\/(\d{2})\/(\d{4})$/,
    // MM-DD-YYYY
    /^(\d{2})-(\d{2})-(\d{4})$/,
    // DD.MM.YYYY
    /^(\d{2})\.(\d{2})\.(\d{4})$/,
    // YYYY-MM-DD (already normalized)
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ];

  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      // Assume MM/DD/YYYY for US format
      const [, part1, part2, part3] = match;
      
      // If already YYYY-MM-DD
      if (part1.length === 4) {
        return `${part1}-${part2}-${part3}`;
      }
      
      // Convert MM/DD/YYYY to YYYY-MM-DD
      return `${part3}-${part1.padStart(2, '0')}-${part2.padStart(2, '0')}`;
    }
  }

  return dateStr;
}

/**
 * Parse amount string to number
 * 
 * @param {string} amountStr - Amount string
 * @param {Object} format - Bank format configuration
 * @returns {number}
 */
function parseAmount(amountStr, format) {
  if (!amountStr) return null;

  // Remove currency symbols and whitespace
  let cleaned = amountStr.replace(/[$€£¥₱\s]/g, '');

  // Handle thousands separator
  if (format.thousandsSeparator === ',') {
    cleaned = cleaned.replace(/,/g, '');
  } else if (format.thousandsSeparator === '.') {
    cleaned = cleaned.replace(/\./g, '');
    // Replace comma decimal with dot
    cleaned = cleaned.replace(',', '.');
  }

  const amount = parseFloat(cleaned);
  return isNaN(amount) ? null : amount;
}

/**
 * Determine if transaction is debit based on description
 * 
 * @param {string} description - Transaction description
 * @returns {boolean}
 */
function isDebitTransaction(description) {
  const debitKeywords = [
    'withdrawal',
    'payment',
    'purchase',
    'fee',
    'charge',
    'debit',
    'transfer out',
    'atm',
  ];

  const lowerDesc = description.toLowerCase();
  return debitKeywords.some(keyword => lowerDesc.includes(keyword));
}

/**
 * Categorize transaction based on description
 * 
 * @param {string} description - Transaction description
 * @param {string} currentType - Current transaction type
 * @returns {string}
 */
function categorizeTransaction(description, currentType) {
  const lowerDesc = description.toLowerCase();

  const categories = {
    FEE: ['fee', 'charge', 'service charge'],
    INTEREST: ['interest', 'dividend'],
    TRANSFER: ['transfer', 'wire', 'ach'],
    ATM: ['atm', 'cash withdrawal'],
    PAYMENT: ['payment', 'bill pay'],
    DEPOSIT: ['deposit', 'credit'],
    PURCHASE: ['purchase', 'pos', 'card purchase'],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => lowerDesc.includes(keyword))) {
      return category;
    }
  }

  return currentType || 'OTHER';
}

/**
 * Extract opening and closing balances
 * 
 * @param {string} text - PDF text
 * @returns {Object}
 */
function extractBalances(text) {
  const balances = {
    opening: null,
    closing: null,
  };

  const openingPatterns = [
    /Opening\s*Balance\s*:?\s*([\d,]+\.\d{2})/i,
    /Beginning\s*Balance\s*:?\s*([\d,]+\.\d{2})/i,
    /Previous\s*Balance\s*:?\s*([\d,]+\.\d{2})/i,
  ];

  const closingPatterns = [
    /Closing\s*Balance\s*:?\s*([\d,]+\.\d{2})/i,
    /Ending\s*Balance\s*:?\s*([\d,]+\.\d{2})/i,
    /Current\s*Balance\s*:?\s*([\d,]+\.\d{2})/i,
  ];

  for (const pattern of openingPatterns) {
    const match = text.match(pattern);
    if (match) {
      balances.opening = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }

  for (const pattern of closingPatterns) {
    const match = text.match(pattern);
    if (match) {
      balances.closing = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }

  return balances;
}

/**
 * Post-process transactions (calculate missing balances, etc.)
 * 
 * @param {Array} transactions - Array of transactions
 * @param {Object} result - Extraction result
 * @returns {Array}
 */
function postProcessTransactions(transactions, result) {
  if (transactions.length === 0) return transactions;

  // Sort by date
  transactions.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateA - dateB;
  });

  // Calculate running balance if missing
  let hasBalance = transactions.some(t => t.balance !== null);
  
  if (!hasBalance && result.openingBalance !== null) {
    let runningBalance = result.openingBalance;
    
    for (const transaction of transactions) {
      runningBalance += transaction.amount || 0;
      transaction.balance = runningBalance;
      transaction.notes += ' (Balance calculated)';
    }
  }

  return transactions;
}

/**
 * Validate transaction data
 * 
 * @param {Transaction} transaction - Transaction object
 * @returns {Object}
 */
function validateTransaction(transaction) {
  const result = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Validate date
  const dateValidation = validateDate(transaction.date);
  if (!dateValidation.valid) {
    result.valid = false;
    result.errors.push(...dateValidation.error.errors);
  }

  // Validate amount
  if (!transaction.debit && !transaction.credit) {
    result.valid = false;
    result.errors.push({
      code: 'MISSING_AMOUNT',
      message: 'Transaction must have debit or credit amount',
    });
  }

  // Validate description
  const descValidation = validateDescription(transaction.description);
  if (descValidation.hasErrors()) {
    result.warnings.push(...descValidation.errors);
  }

  return result;
}

/**
 * Extract transactions from specific bank format
 * 
 * @param {string} text - PDF text
 * @param {string} bankId - Bank identifier
 * @returns {Promise<ExtractionResult>}
 */
export async function extractByBankFormat(text, bankId) {
  const formats = await loadBankFormats();
  const format = formats.find(f => f.bankId === bankId);
  
  if (!format) {
    throw new Error(`Bank format not found: ${bankId}`);
  }

  return extractTransactions(text, { bankFormat: format });
}

/**
 * Get supported bank formats
 * 
 * @returns {Promise<Array>}
 */
export async function getSupportedBankFormats() {
  const formats = await loadBankFormats();
  return formats.map(f => ({
    bankId: f.bankId,
    bankName: f.bankName,
    country: f.country,
  }));
}

export default {
  extractTransactions,
  extractByBankFormat,
  getSupportedBankFormats,
  Transaction,
  ExtractionResult,
};