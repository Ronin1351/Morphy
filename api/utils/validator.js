/**
 * Validator Utility - Data Validation and Rules
 * Validates files, dates, amounts, transactions, and data integrity
 * 
 * @module validator
 */

// Load configuration from environment
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50') * 1024 * 1024;
const MAX_FUTURE_DAYS = parseInt(process.env.MAX_FUTURE_DAYS || '7');
const MAX_PAST_YEARS = parseInt(process.env.MAX_PAST_YEARS || '10');
const MAX_TRANSACTION_AMOUNT = parseFloat(process.env.MAX_TRANSACTION_AMOUNT || '999999.99');
const DECIMAL_PLACES = parseInt(process.env.DECIMAL_PLACES || '2');
const BALANCE_TOLERANCE = parseFloat(process.env.BALANCE_TOLERANCE || '0.02');

// Validation error codes
export const ErrorCodes = {
  // File errors
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  CORRUPTED_FILE: 'CORRUPTED_FILE',
  EMPTY_FILE: 'EMPTY_FILE',
  
  // Date errors
  INVALID_DATE_FORMAT: 'INVALID_DATE_FORMAT',
  DATE_OUT_OF_RANGE: 'DATE_OUT_OF_RANGE',
  FUTURE_DATE: 'FUTURE_DATE',
  DATE_TOO_OLD: 'DATE_TOO_OLD',
  
  // Amount errors
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  NEGATIVE_AMOUNT: 'NEGATIVE_AMOUNT',
  AMOUNT_TOO_LARGE: 'AMOUNT_TOO_LARGE',
  INVALID_DECIMAL_PLACES: 'INVALID_DECIMAL_PLACES',
  
  // Transaction errors
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
  BALANCE_MISMATCH: 'BALANCE_MISMATCH',
  INVALID_DESCRIPTION: 'INVALID_DESCRIPTION',
  
  // General errors
  VALIDATION_FAILED: 'VALIDATION_FAILED',
};

// Severity levels
export const Severity = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

/**
 * Validation result structure
 */
class ValidationResult {
  constructor() {
    this.valid = true;
    this.errors = [];
    this.warnings = [];
  }

  addError(code, message, severity = Severity.HIGH, context = {}) {
    this.valid = false;
    this.errors.push({
      code,
      message,
      severity,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  addWarning(code, message, severity = Severity.LOW, context = {}) {
    this.warnings.push({
      code,
      message,
      severity,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  hasErrors() {
    return this.errors.length > 0;
  }

  hasWarnings() {
    return this.warnings.length > 0;
  }

  getSummary() {
    return {
      valid: this.valid,
      errorCount: this.errors.length,
      warningCount: this.warnings.length,
      criticalErrors: this.errors.filter(e => e.severity === Severity.CRITICAL).length,
    };
  }
}

/**
 * Validate uploaded file
 * 
 * @param {Buffer} fileBuffer - File content
 * @param {string} filename - Original filename
 * @param {string} mimetype - MIME type
 * @returns {ValidationResult}
 */
export function validateFile(fileBuffer, filename, mimetype) {
  const result = new ValidationResult();

  // Normalize buffer to a Uint8Array
  let bytes;
  if (!fileBuffer) {
    result.addError(ErrorCodes.EMPTY_FILE, 'File is empty', Severity.CRITICAL, { filename });
    return result;
  } else if (Buffer.isBuffer(fileBuffer)) {
    bytes = fileBuffer; // Node Buffer is fine
  } else if (fileBuffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(fileBuffer);
  } else if (ArrayBuffer.isView(fileBuffer)) {
    bytes = new Uint8Array(fileBuffer.buffer);
  } else {
    result.addError(ErrorCodes.CORRUPTED_FILE, 'Unsupported file buffer type', Severity.CRITICAL, { filename, type: typeof fileBuffer });
    return result;
  }

  // Size checks
  if (bytes.length === 0) {
    result.addError(ErrorCodes.EMPTY_FILE, 'File is empty', Severity.CRITICAL, { filename });
    return result;
  }
  if (bytes.length > MAX_FILE_SIZE) {
    result.addError(
      ErrorCodes.FILE_TOO_LARGE,
      `File size (${(bytes.length/1024/1024).toFixed(2)}MB) exceeds maximum allowed (${MAX_FILE_SIZE/1024/1024}MB)`,
      Severity.CRITICAL,
      { size: bytes.length, maxSize: MAX_FILE_SIZE }
    );
  }

  // Type / extension checks
  const allowedTypes = ['application/pdf'];
  const allowedExtensions = ['.pdf'];

  const safeName = typeof filename === 'string' ? filename : '';
  const dot = safeName.lastIndexOf('.');
  const fileExtension = dot !== -1 ? safeName.slice(dot).toLowerCase() : '';
  const typeNormalized = (mimetype || '').split(';')[0].trim().toLowerCase();

  const typeOk = allowedTypes.includes(typeNormalized) || typeNormalized.startsWith('application/pdf');
  const extOk = allowedExtensions.includes(fileExtension);

  if (!typeOk || !extOk) {
    result.addError(
      ErrorCodes.INVALID_FILE_TYPE,
      `Invalid file type. Only PDF files are supported. Received: ${mimetype || 'unknown'} (${fileExtension || 'no extension'})`,
      Severity.CRITICAL,
      { mimetype, filename }
    );
  }

  // PDF signature (guard length first)
  const hasPdfSignature =
    bytes.length >= 4 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46;   // F

  if (!hasPdfSignature) {
    result.addError(
      ErrorCodes.CORRUPTED_FILE,
      'File does not appear to be a valid PDF (invalid signature)',
      Severity.CRITICAL,
      { filename }
    );
  }

  return result;
}

/**
 * Validate date string and parse
 * 
 * @param {string} dateStr - Date string to validate
 * @param {Object} options - Validation options
 * @returns {Object} { valid: boolean, date: Date|null, error: ValidationResult }
 */
export function validateDate(dateStr, options = {}) {
  const result = new ValidationResult();
  const { allowFuture = false, allowOld = true } = options;

  if (!dateStr || typeof dateStr !== 'string') {
    result.addError(
      ErrorCodes.INVALID_DATE_FORMAT,
      'Date is required and must be a string',
      Severity.HIGH,
      { dateStr }
    );
    return { valid: false, date: null, error: result };
  }

  // Try to parse date (supports multiple formats)
  let parsedDate = null;
  const formats = [
    // ISO format
    /^\d{4}-\d{2}-\d{2}$/,
    // US format
    /^\d{2}\/\d{2}\/\d{4}$/,
    // EU format
    /^\d{2}\.\d{2}\.\d{4}$/,
    // Other common formats
    /^\d{2}-\d{2}-\d{4}$/,
  ];

  try {
    parsedDate = new Date(dateStr);
    
    // Check if date is valid
    if (isNaN(parsedDate.getTime())) {
      throw new Error('Invalid date');
    }
  } catch (error) {
    result.addError(
      ErrorCodes.INVALID_DATE_FORMAT,
      `Invalid date format: ${dateStr}`,
      Severity.HIGH,
      { dateStr, supportedFormats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD.MM.YYYY'] }
    );
    return { valid: false, date: null, error: result };
  }

  // Check date range
  const now = new Date();
  const maxFutureDate = new Date(now.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60 * 1000);
  const minPastDate = new Date(now.getFullYear() - MAX_PAST_YEARS, 0, 1);

  if (!allowFuture && parsedDate > maxFutureDate) {
    result.addError(
      ErrorCodes.FUTURE_DATE,
      `Date is in the future: ${dateStr}`,
      Severity.HIGH,
      { dateStr, maxFutureDate: maxFutureDate.toISOString() }
    );
  }

  if (!allowOld && parsedDate < minPastDate) {
    result.addWarning(
      ErrorCodes.DATE_TOO_OLD,
      `Date is older than ${MAX_PAST_YEARS} years: ${dateStr}`,
      Severity.MEDIUM,
      { dateStr, minPastDate: minPastDate.toISOString() }
    );
  }

  return {
    valid: !result.hasErrors(),
    date: parsedDate,
    error: result,
  };
}

/**
 * Validate monetary amount
 * 
 * @param {string|number} amount - Amount to validate
 * @param {Object} options - Validation options
 * @returns {Object} { valid: boolean, amount: number|null, error: ValidationResult }
 */
export function validateAmount(amount, options = {}) {
  const result = new ValidationResult();
  const { allowNegative = false, allowZero = true } = options;

  if (amount === null || amount === undefined || amount === '') {
    result.addError(
      ErrorCodes.INVALID_AMOUNT,
      'Amount is required',
      Severity.HIGH,
      { amount }
    );
    return { valid: false, amount: null, error: result };
  }

  // Convert to number if string
  let numericAmount;
  if (typeof amount === 'string') {
    // Remove currency symbols, spaces, and commas
    const cleanAmount = amount.replace(/[$€£¥,\s]/g, '');
    numericAmount = parseFloat(cleanAmount);
  } else {
    numericAmount = parseFloat(amount);
  }

  // Check if valid number
  if (isNaN(numericAmount)) {
    result.addError(
      ErrorCodes.INVALID_AMOUNT,
      `Amount is not a valid number: ${amount}`,
      Severity.HIGH,
      { amount }
    );
    return { valid: false, amount: null, error: result };
  }

  // Check negative amounts
  if (!allowNegative && numericAmount < 0) {
    result.addError(
      ErrorCodes.NEGATIVE_AMOUNT,
      `Amount cannot be negative: ${numericAmount}`,
      Severity.MEDIUM,
      { amount: numericAmount }
    );
  }

  // Check zero amounts
  if (!allowZero && numericAmount === 0) {
    result.addWarning(
      ErrorCodes.INVALID_AMOUNT,
      'Amount is zero',
      Severity.LOW,
      { amount: numericAmount }
    );
  }

  // Check maximum amount
  if (Math.abs(numericAmount) > MAX_TRANSACTION_AMOUNT) {
    result.addWarning(
      ErrorCodes.AMOUNT_TOO_LARGE,
      `Amount exceeds maximum (${MAX_TRANSACTION_AMOUNT}): ${numericAmount}`,
      Severity.MEDIUM,
      { amount: numericAmount, maxAmount: MAX_TRANSACTION_AMOUNT }
    );
  }

  // Check decimal places
  const decimalPart = numericAmount.toString().split('.')[1];
  if (decimalPart && decimalPart.length > DECIMAL_PLACES) {
    result.addWarning(
      ErrorCodes.INVALID_DECIMAL_PLACES,
      `Amount has too many decimal places (${decimalPart.length}), expected ${DECIMAL_PLACES}`,
      Severity.LOW,
      { amount: numericAmount, decimalPlaces: decimalPart.length }
    );
  }

  // Round to specified decimal places
  const roundedAmount = Math.round(numericAmount * Math.pow(10, DECIMAL_PLACES)) / Math.pow(10, DECIMAL_PLACES);

  return {
    valid: !result.hasErrors(),
    amount: roundedAmount,
    error: result,
  };
}

/**
 * Validate transaction description
 * 
 * @param {string} description - Transaction description
 * @returns {ValidationResult}
 */
export function validateDescription(description) {
  const result = new ValidationResult();

  if (!description || typeof description !== 'string') {
    result.addError(
      ErrorCodes.INVALID_DESCRIPTION,
      'Description is required',
      Severity.MEDIUM,
      { description }
    );
    return result;
  }

  const trimmed = description.trim();

  // Check minimum length
  if (trimmed.length < 3) {
    result.addWarning(
      ErrorCodes.INVALID_DESCRIPTION,
      'Description is too short (minimum 3 characters)',
      Severity.LOW,
      { description: trimmed, length: trimmed.length }
    );
  }

  // Check maximum length
  if (trimmed.length > 500) {
    result.addWarning(
      ErrorCodes.INVALID_DESCRIPTION,
      'Description is very long (>500 characters)',
      Severity.LOW,
      { description: trimmed.substring(0, 50) + '...', length: trimmed.length }
    );
  }

  // Check for suspicious patterns
  if (/[<>{}]/g.test(trimmed)) {
    result.addWarning(
      ErrorCodes.INVALID_DESCRIPTION,
      'Description contains potentially unsafe characters',
      Severity.MEDIUM,
      { description: trimmed }
    );
  }

  return result;
}

/**
 * Validate single transaction object
 * 
 * @param {Object} transaction - Transaction object
 * @param {number} index - Transaction index (for error reporting)
 * @returns {ValidationResult}
 */
export function validateTransaction(transaction, index = 0) {
  const result = new ValidationResult();
  const context = { transactionIndex: index };

  // Validate required fields
  if (!transaction.date) {
    result.addError(
      ErrorCodes.MISSING_REQUIRED_FIELD,
      'Transaction date is required',
      Severity.HIGH,
      { ...context, field: 'date' }
    );
  } else {
    const dateValidation = validateDate(transaction.date);
    if (!dateValidation.valid) {
      dateValidation.error.errors.forEach(err => result.errors.push({ ...err, context }));
    }
  }

  // Validate amount
  if (transaction.amount === undefined && !transaction.debit && !transaction.credit) {
    result.addError(
      ErrorCodes.MISSING_REQUIRED_FIELD,
      'Transaction must have amount, debit, or credit',
      Severity.HIGH,
      { ...context, field: 'amount' }
    );
  }

  // Validate description
  if (transaction.description) {
    const descValidation = validateDescription(transaction.description);
    descValidation.errors.forEach(err => result.errors.push({ ...err, context }));
    descValidation.warnings.forEach(warn => result.warnings.push({ ...warn, context }));
  }

  // Validate balance if present
  if (transaction.balance !== undefined) {
    const balanceValidation = validateAmount(transaction.balance, { allowNegative: true });
    if (!balanceValidation.valid) {
      balanceValidation.error.errors.forEach(err => 
        result.errors.push({ ...err, context: { ...context, field: 'balance' } })
      );
    }
  }

  return result;
}

/**
 * Validate balance consistency across transactions
 * 
 * @param {Array} transactions - Array of transaction objects
 * @returns {ValidationResult}
 */
export function validateBalanceConsistency(transactions) {
  const result = new ValidationResult();

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return result;
  }

  for (let i = 1; i < transactions.length; i++) {
    const prev = transactions[i - 1];
    const curr = transactions[i];

    if (prev.balance !== undefined && curr.balance !== undefined && curr.amount !== undefined) {
      const expectedBalance = prev.balance + curr.amount;
      const actualBalance = curr.balance;
      const diff = Math.abs(expectedBalance - actualBalance);

      if (diff > BALANCE_TOLERANCE) {
        result.addWarning(
          ErrorCodes.BALANCE_MISMATCH,
          `Balance mismatch at transaction ${i}: expected ${expectedBalance.toFixed(2)}, got ${actualBalance.toFixed(2)} (diff: ${diff.toFixed(2)})`,
          Severity.MEDIUM,
          {
            transactionIndex: i,
            expectedBalance,
            actualBalance,
            difference: diff,
          }
        );
      }
    }
  }

  return result;
}

/**
 * Detect duplicate transactions
 * 
 * @param {Array} transactions - Array of transaction objects
 * @returns {ValidationResult}
 */
export function detectDuplicates(transactions) {
  const result = new ValidationResult();
  const seen = new Map();

  transactions.forEach((transaction, index) => {
    const key = `${transaction.date}_${transaction.amount}_${transaction.description}`;
    
    if (seen.has(key)) {
      result.addWarning(
        ErrorCodes.DUPLICATE_TRANSACTION,
        `Potential duplicate transaction at index ${index}`,
        Severity.MEDIUM,
        {
          transactionIndex: index,
          duplicateOf: seen.get(key),
          transaction,
        }
      );
    } else {
      seen.set(key, index);
    }
  });

  return result;
}

/**
 * Validate array of transactions
 * 
 * @param {Array} transactions - Array of transaction objects
 * @returns {ValidationResult}
 */
export function validateTransactions(transactions) {
  const result = new ValidationResult();

  if (!Array.isArray(transactions)) {
    result.addError(
      ErrorCodes.VALIDATION_FAILED,
      'Transactions must be an array',
      Severity.CRITICAL
    );
    return result;
  }

  if (transactions.length === 0) {
    result.addWarning(
      ErrorCodes.VALIDATION_FAILED,
      'No transactions found',
      Severity.HIGH
    );
    return result;
  }

  // Validate each transaction
  transactions.forEach((transaction, index) => {
    const transactionResult = validateTransaction(transaction, index);
    transactionResult.errors.forEach(err => result.errors.push(err));
    transactionResult.warnings.forEach(warn => result.warnings.push(warn));
  });

  // Check for duplicates
  const duplicateResult = detectDuplicates(transactions);
  duplicateResult.warnings.forEach(warn => result.warnings.push(warn));

  // Validate balance consistency
  const balanceResult = validateBalanceConsistency(transactions);
  balanceResult.warnings.forEach(warn => result.warnings.push(warn));

  return result;
}

export default {
  validateFile,
  validateDate,
  validateAmount,
  validateDescription,
  validateTransaction,
  validateTransactions,
  validateBalanceConsistency,
  detectDuplicates,
  ValidationResult,
  ErrorCodes,
  Severity,
};
