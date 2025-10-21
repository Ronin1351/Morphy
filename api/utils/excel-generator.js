/**
 * Excel Generator - Create formatted Excel workbooks from transaction data
 * Supports XLSX format with multiple sheets and professional styling
 * 
 * @module excel-generator
 */

import ExcelJS from 'exceljs';

// Configuration
const INCLUDE_SUMMARY = process.env.INCLUDE_SUMMARY_SHEET !== 'false';
const INCLUDE_LOG = process.env.INCLUDE_PROCESSING_LOG !== 'false';
const DEFAULT_FORMAT = process.env.DEFAULT_OUTPUT_FORMAT || 'xlsx';

// Styling constants
const COLORS = {
  headerBg: 'FF0066CC',
  headerText: 'FFFFFFFF',
  summaryBg: 'FFF0F8FF',
  warningBg: 'FFFFF8DC',
  errorBg: 'FFFFE4E1',
  accentBg: 'FFE8F4F8',
  borderColor: 'FFD3D3D3',
};

/**
 * Excel generation result
 */
class ExcelGenerationResult {
  constructor() {
    this.success = false;
    this.buffer = null;
    this.filename = null;
    this.size = 0;
    this.sheets = [];
    this.errors = [];
  }
}

/**
 * Generate Excel workbook from extraction result
 * 
 * @param {Object} extractionResult - Transaction extraction result
 * @param {Object} options - Generation options
 * @returns {Promise<ExcelGenerationResult>}
 */
export async function generateExcel(extractionResult, options = {}) {
  const result = new ExcelGenerationResult();
  
  try {
    const workbook = new ExcelJS.Workbook();

    // Set workbook properties
    workbook.creator = 'Bank Statement Converter';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.properties.date1904 = false;

    // Add Summary Sheet
    if (INCLUDE_SUMMARY || options.includeSummary) {
      addSummarySheet(workbook, extractionResult, options);
      result.sheets.push('Summary');
    }

    // Add Transactions Sheet
    addTransactionsSheet(workbook, extractionResult, options);
    result.sheets.push('Transactions');

    // Add Processing Log Sheet
    if (INCLUDE_LOG || options.includeLog) {
      addProcessingLogSheet(workbook, extractionResult, options);
      result.sheets.push('Processing Log');
    }

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = options.filename || `statement_${timestamp}.xlsx`;

    // Return buffer (upload will be handled by caller)
    result.success = true;
    result.buffer = buffer;
    result.filename = filename;
    result.size = buffer.length;

  } catch (error) {
    result.success = false;
    result.errors.push({
      code: 'EXCEL_GENERATION_FAILED',
      message: 'Failed to generate Excel file',
      details: error.message,
    });
  }

  return result;
}

/**
 * Add Summary Sheet
 * 
 * @param {ExcelJS.Workbook} workbook - Excel workbook
 * @param {Object} extractionResult - Extraction result
 * @param {Object} options - Options
 */
function addSummarySheet(workbook, extractionResult, options) {
  const sheet = workbook.addWorksheet('Summary', {
    properties: { tabColor: { argb: 'FF0066CC' } },
  });

  // Set column widths
  sheet.columns = [
    { width: 30 },
    { width: 40 },
  ];

  let row = 1;

  // Title
  sheet.mergeCells(`A${row}:B${row}`);
  const titleCell = sheet.getCell(`A${row}`);
  titleCell.value = 'Bank Statement Summary';
  titleCell.font = { size: 18, bold: true, color: { argb: COLORS.headerText } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(row).height = 30;
  row += 2;

  // Account Information Section
  addSectionHeader(sheet, row++, 'Account Information');
  
  const metadata = extractionResult.metadata || {};
  const accountInfo = metadata.accountInfo || {};
  
  addDataRow(sheet, row++, 'Account Number', accountInfo.accountNumber || 'N/A');
  addDataRow(sheet, row++, 'Account Holder', accountInfo.accountHolder || 'N/A');
  addDataRow(sheet, row++, 'Bank Name', extractionResult.bankFormat?.bankName || 'Unknown');
  
  if (metadata.statementPeriod) {
    addDataRow(sheet, row++, 'Statement Period', 
      `${metadata.statementPeriod.from || 'N/A'} to ${metadata.statementPeriod.to || 'N/A'}`);
  }
  
  row++;

  // Transaction Summary Section
  addSectionHeader(sheet, row++, 'Transaction Summary');
  addDataRow(sheet, row++, 'Opening Balance', formatCurrency(extractionResult.openingBalance));
  addDataRow(sheet, row++, 'Total Credits', formatCurrency(extractionResult.totalCredits), COLORS.accentBg);
  addDataRow(sheet, row++, 'Total Debits', formatCurrency(extractionResult.totalDebits), COLORS.warningBg);
  addDataRow(sheet, row++, 'Closing Balance', formatCurrency(extractionResult.closingBalance));
  addDataRow(sheet, row++, 'Net Change', 
    formatCurrency(extractionResult.totalCredits - extractionResult.totalDebits));
  row++;

  // Processing Statistics Section
  addSectionHeader(sheet, row++, 'Processing Statistics');
  addDataRow(sheet, row++, 'Total Transactions', extractionResult.totalTransactions);
  addDataRow(sheet, row++, 'Valid Transactions', extractionResult.validTransactions, COLORS.accentBg);
  addDataRow(sheet, row++, 'Invalid Transactions', extractionResult.invalidTransactions, 
    extractionResult.invalidTransactions > 0 ? COLORS.errorBg : null);
  addDataRow(sheet, row++, 'Warnings', extractionResult.warnings.length,
    extractionResult.warnings.length > 0 ? COLORS.warningBg : null);
  addDataRow(sheet, row++, 'Errors', extractionResult.errors.length,
    extractionResult.errors.length > 0 ? COLORS.errorBg : null);
  row++;

  // Processing Details Section
  addSectionHeader(sheet, row++, 'Processing Details');
  addDataRow(sheet, row++, 'Processing Date', new Date().toLocaleString());
  addDataRow(sheet, row++, 'Source File', options.sourceFilename || 'N/A');
  addDataRow(sheet, row++, 'Bank Format Detected', extractionResult.bankFormat?.bankName || 'Unknown');
  addDataRow(sheet, row++, 'Processing Status', extractionResult.success ? 'Success' : 'Failed',
    extractionResult.success ? COLORS.accentBg : COLORS.errorBg);
}

/**
 * Add Transactions Sheet
 * 
 * @param {ExcelJS.Workbook} workbook - Excel workbook
 * @param {Object} extractionResult - Extraction result
 * @param {Object} options - Options
 */
function addTransactionsSheet(workbook, extractionResult, options) {
  const sheet = workbook.addWorksheet('Transactions', {
    properties: { tabColor: { argb: 'FF28A745' } },
  });

  // Define columns
  sheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Description', key: 'description', width: 50 },
    { header: 'Debit', key: 'debit', width: 15 },
    { header: 'Credit', key: 'credit', width: 15 },
    { header: 'Balance', key: 'balance', width: 15 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Reference', key: 'reference', width: 20 },
    { header: 'Status', key: 'status', width: 12 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: COLORS.headerText } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 25;

  // Add border to header
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.borderColor } },
      bottom: { style: 'medium', color: { argb: COLORS.borderColor } },
      left: { style: 'thin', color: { argb: COLORS.borderColor } },
      right: { style: 'thin', color: { argb: COLORS.borderColor } },
    };
  });

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Add transactions
  const transactions = extractionResult.transactions || [];
  
  transactions.forEach((transaction, index) => {
    const row = sheet.addRow({
      date: transaction.date,
      description: transaction.description,
      debit: transaction.debit || '',
      credit: transaction.credit || '',
      balance: transaction.balance || '',
      type: transaction.transactionType || 'OTHER',
      reference: transaction.reference || '',
      status: transaction.processingStatus || 'VALID',
    });

    // Format currency columns
    ['debit', 'credit', 'balance'].forEach(key => {
      const cell = row.getCell(key);
      if (cell.value) {
        cell.numFmt = '"$"#,##0.00';
        cell.alignment = { horizontal: 'right' };
      }
    });

    // Center align type and status
    row.getCell('type').alignment = { horizontal: 'center' };
    row.getCell('status').alignment = { horizontal: 'center' };

    // Highlight rows with warnings or errors
    if (transaction.processingStatus === 'WARNING') {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.warningBg } };
      });
    } else if (transaction.processingStatus === 'ERROR') {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.errorBg } };
      });
    } else if (index % 2 === 0) {
      // Alternate row coloring for readability
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F9F9' } };
      });
    }

    // Add borders
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: COLORS.borderColor } },
        bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
        left: { style: 'thin', color: { argb: COLORS.borderColor } },
        right: { style: 'thin', color: { argb: COLORS.borderColor } },
      };
    });
  });

  // Add totals row
  const totalRow = sheet.addRow({
    date: '',
    description: 'TOTAL',
    debit: { formula: `SUM(C2:C${transactions.length + 1})` },
    credit: { formula: `SUM(D2:D${transactions.length + 1})` },
    balance: '',
    type: '',
    reference: '',
    status: '',
  });

  totalRow.font = { bold: true };
  totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.accentBg } };
  
  ['debit', 'credit'].forEach(key => {
    const cell = totalRow.getCell(key);
    cell.numFmt = '"$"#,##0.00';
    cell.alignment = { horizontal: 'right' };
  });

  // Add data validation for status column (if needed for editing)
  sheet.getColumn('status').eachCell((cell, rowNumber) => {
    if (rowNumber > 1) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: ['"VALID,WARNING,ERROR"'],
      };
    }
  });
}

/**
 * Add Processing Log Sheet
 * 
 * @param {ExcelJS.Workbook} workbook - Excel workbook
 * @param {Object} extractionResult - Extraction result
 * @param {Object} options - Options
 */
function addProcessingLogSheet(workbook, extractionResult, options) {
  const sheet = workbook.addWorksheet('Processing Log', {
    properties: { tabColor: { argb: 'FFFFC107' } },
  });

  // Set column widths
  sheet.columns = [
    { header: 'Timestamp', key: 'timestamp', width: 20 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Code', key: 'code', width: 25 },
    { header: 'Message', key: 'message', width: 60 },
    { header: 'Context', key: 'context', width: 40 },
  ];

  // Style header
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: COLORS.headerText } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 25;

  // Freeze header
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Add errors
  (extractionResult.errors || []).forEach((error) => {
    const row = sheet.addRow({
      timestamp: error.timestamp || new Date().toISOString(),
      type: 'ERROR',
      code: error.code || 'UNKNOWN',
      message: error.message || '',
      context: JSON.stringify(error.context || {}),
    });

    row.getCell('type').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.errorBg } };
    row.getCell('type').font = { bold: true, color: { argb: 'FFDC3545' } };
  });

  // Add warnings
  (extractionResult.warnings || []).forEach((warning) => {
    const row = sheet.addRow({
      timestamp: warning.timestamp || new Date().toISOString(),
      type: 'WARNING',
      code: warning.code || 'UNKNOWN',
      message: warning.message || '',
      context: JSON.stringify(warning.context || {}),
    });

    row.getCell('type').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.warningBg } };
    row.getCell('type').font = { bold: true, color: { argb: 'FFFFC107' } };
  });

  // Add processing metadata
  sheet.addRow({});
  sheet.addRow({
    timestamp: '',
    type: 'INFO',
    code: 'PROCESSING_COMPLETE',
    message: `Successfully processed ${extractionResult.totalTransactions} transactions`,
    context: JSON.stringify(extractionResult.metadata || {}),
  });
}

/**
 * Helper: Add section header
 */
function addSectionHeader(sheet, rowNumber, title) {
  sheet.mergeCells(`A${rowNumber}:B${rowNumber}`);
  const cell = sheet.getCell(`A${rowNumber}`);
  cell.value = title;
  cell.font = { size: 12, bold: true, color: { argb: COLORS.headerText } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } };
  cell.alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getRow(rowNumber).height = 20;
}

/**
 * Helper: Add data row
 */
function addDataRow(sheet, rowNumber, label, value, bgColor = null) {
  const labelCell = sheet.getCell(`A${rowNumber}`);
  const valueCell = sheet.getCell(`B${rowNumber}`);
  
  labelCell.value = label;
  labelCell.font = { bold: true };
  labelCell.alignment = { horizontal: 'left' };
  
  valueCell.value = value;
  valueCell.alignment = { horizontal: 'right' };

  if (bgColor) {
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
  }

  // Add borders
  [labelCell, valueCell].forEach(cell => {
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.borderColor } },
      bottom: { style: 'thin', color: { argb: COLORS.borderColor } },
      left: { style: 'thin', color: { argb: COLORS.borderColor } },
      right: { style: 'thin', color: { argb: COLORS.borderColor } },
    };
  });
}

/**
 * Helper: Format currency
 */
function formatCurrency(value) {
  if (value === null || value === undefined) {
    return 'N/A';
  }
  return `$${parseFloat(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Generate CSV instead of Excel (simpler format)
 * 
 * @param {Object} extractionResult - Transaction extraction result
 * @param {Object} options - Generation options
 * @returns {Promise<ExcelGenerationResult>}
 */
export async function generateCSV(extractionResult, options = {}) {
  const result = new ExcelGenerationResult();

  try {
    // Create CSV header
    const headers = ['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Type', 'Status'];
    const rows = [headers.join(',')];

    // Add transaction rows
    const transactions = extractionResult.transactions || [];
    transactions.forEach(transaction => {
      const row = [
        transaction.date || '',
        `"${(transaction.description || '').replace(/"/g, '""')}"`, // Escape quotes
        transaction.debit || '',
        transaction.credit || '',
        transaction.balance || '',
        transaction.transactionType || '',
        transaction.processingStatus || '',
      ];
      rows.push(row.join(','));
    });

    const csvContent = rows.join('\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = options.filename || `statement_${timestamp}.csv`;

    // Return buffer (upload will be handled by caller)
    result.success = true;
    result.buffer = buffer;
    result.filename = filename;
    result.size = buffer.length;
    result.sheets = ['Transactions'];

  } catch (error) {
    result.success = false;
    result.errors.push({
      code: 'CSV_GENERATION_FAILED',
      message: 'Failed to generate CSV file',
      details: error.message,
    });
  }

  return result;
}

/**
 * Generate output file (Excel or CSV based on format)
 * 
 * @param {Object} extractionResult - Transaction extraction result
 * @param {Object} options - Generation options
 * @returns {Promise<ExcelGenerationResult>}
 */
export async function generateOutput(extractionResult, options = {}) {
  const format = options.format || DEFAULT_FORMAT;

  if (format === 'csv') {
    return generateCSV(extractionResult, options);
  } else {
    return generateExcel(extractionResult, options);
  }
}

export default {
  generateExcel,
  generateCSV,
  generateOutput,
  ExcelGenerationResult,
};