/**
 * API Client - Frontend HTTP Client for Backend Communication
 * Handles all API requests with error handling and retries
 * 
 * @module api
 */

// Configuration
const API_BASE_URL = window.location.origin;
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLL_ATTEMPTS = 60; // 2 minutes max

/**
 * Debug logging
 */
function debugLog(method, url, data = {}) {
  console.log(`[API] ${method} ${url}`, data);
}

function errorLog(method, url, error, data = {}) {
  console.error(`[API ERROR] ${method} ${url}`, {
    error: error?.message,
    ...data
  });
}

/**
 * File validation
 * 
 * @param {File} file - File to validate
 * @returns {{valid: boolean, errors: Array, warnings: Array}}
 */
function validateFile(file) {
  debugLog('VALIDATE', 'File', {
    name: file.name,
    size: file.size,
    type: file.type
  });

  const errors = [];
  const warnings = [];

  // Check if file exists
  if (!file) {
    errors.push({
      code: 'NO_FILE',
      message: 'No file provided'
    });
    return { valid: false, errors, warnings };
  }

  // Check file type
  const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  
  if (!isPDF) {
    errors.push({
      code: 'INVALID_TYPE',
      message: 'Only PDF files are supported'
    });
  }

  // Check file size (50MB max)
  const MAX_SIZE = 50 * 1024 * 1024;
  
  if (file.size === 0) {
    errors.push({
      code: 'EMPTY_FILE',
      message: 'File is empty (0 bytes)'
    });
  } else if (file.size > MAX_SIZE) {
    errors.push({
      code: 'FILE_TOO_LARGE',
      message: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed (50MB)`
    });
  }

  // Warnings for large files
  if (file.size > 10 * 1024 * 1024 && file.size <= MAX_SIZE) {
    warnings.push({
      code: 'LARGE_FILE',
      message: `Large file (${(file.size / 1024 / 1024).toFixed(2)}MB) may take longer to process`
    });
  }

  const result = {
    valid: errors.length === 0,
    errors,
    warnings
  };

  debugLog('VALIDATE', 'Result', result);
  return result;
}

/**
 * Convert file
 * 
 * @param {File} file - PDF file to convert
 * @param {Object} options - Conversion options
 * @param {Function} onProgress - Progress callback (0-100)
 * @returns {Promise<{processingId: string}>}
 */
async function convertFile(file, options = {}, onProgress = null) {
  debugLog('CONVERT', 'Starting conversion', {
    filename: file.name,
    size: file.size,
    options
  });

  try {
    // Create form data
    const formData = new FormData();
    formData.append('file', file);
    formData.append('format', options.format || 'xlsx');
    
    if (options.bankFormat) {
      formData.append('bankFormat', options.bankFormat);
    }
    
    formData.append('includeSummary', String(options.includeSummary !== false));
    formData.append('includeLog', String(options.includeLog !== false));

    debugLog('CONVERT', 'Sending request to /api/convert');

    // Call progress callback for upload start
    if (onProgress) {
      onProgress(5);
    }

    // Send request
    const response = await fetch(`${API_BASE_URL}/api/convert`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type header - browser will set it with boundary for multipart/form-data
    });

    debugLog('CONVERT', 'Response received', {
      status: response.status,
      ok: response.ok
    });

    // Call progress callback for upload complete
    if (onProgress) {
      onProgress(10);
    }

    // Parse response
    const data = await response.json();

    if (!response.ok) {
      debugLog('CONVERT', 'Request failed', {
        status: response.status,
        error: data.error
      });

      throw new Error(data.error?.message || 'Conversion request failed');
    }

    if (!data.success || !data.processingId) {
      throw new Error('Invalid response from server');
    }

    debugLog('CONVERT', 'Conversion started successfully', {
      processingId: data.processingId,
      fileId: data.fileId
    });

    return {
      processingId: data.processingId,
      fileId: data.fileId,
      pollUrl: data.pollUrl
    };

  } catch (error) {
    errorLog('CONVERT', 'Conversion failed', error, {
      filename: file.name
    });

    // Re-throw with more context
    if (error.message.includes('Failed to fetch')) {
      throw new Error('Network error: Unable to reach server. Please check your connection.');
    }

    throw error;
  }
}

/**
 * Poll processing status
 * 
 * @param {string} processingId - Processing ID from convertFile
 * @param {Function} onProgress - Progress callback with status object
 * @param {number} maxAttempts - Maximum polling attempts
 * @returns {Promise<Object>} Final result
 */
async function pollStatus(processingId, onProgress = null, maxAttempts = MAX_POLL_ATTEMPTS) {
  debugLog('POLL', 'Starting status polling', {
    processingId,
    maxAttempts,
    interval: POLL_INTERVAL
  });

  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      debugLog('POLL', `Attempt ${attempts}/${maxAttempts}`, { processingId });

      const response = await fetch(`${API_BASE_URL}/api/status?id=${processingId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Processing ID not found or expired');
        }
        throw new Error(data.error?.message || 'Status check failed');
      }

      debugLog('POLL', 'Status received', {
        status: data.status,
        progress: data.progress,
        currentStep: data.currentStep
      });

      // Call progress callback
      if (onProgress) {
        onProgress({
          status: data.status,
          progress: data.progress,
          currentStep: data.currentStep,
          attempt: attempts
        });
      }

      // Check if completed
      if (data.status === 'completed') {
        debugLog('POLL', 'Processing completed successfully', {
          result: data.result
        });

        return {
          status: 'completed',
          processingId: data.processingId,
          result: data.result,
          duration: data.duration
        };
      }

      // Check if failed
      if (data.status === 'error') {
        debugLog('POLL', 'Processing failed', {
          error: data.error
        });

        throw new Error(data.error?.message || 'Processing failed');
      }

      // Still processing, wait before next poll
      await sleep(POLL_INTERVAL);

    } catch (error) {
      errorLog('POLL', `Attempt ${attempts} failed`, error, { processingId });

      // If it's the last attempt, throw the error
      if (attempts >= maxAttempts) {
        throw new Error(`Polling timeout after ${attempts} attempts: ${error.message}`);
      }

      // For other errors, wait and retry
      if (!error.message.includes('not found')) {
        await sleep(POLL_INTERVAL);
      } else {
        throw error; // Don't retry if processing ID not found
      }
    }
  }

  // Timeout
  throw new Error(`Processing timeout: No response after ${maxAttempts * POLL_INTERVAL / 1000} seconds`);
}

/**
 * Download file
 * 
 * @param {string} url - Download URL
 * @param {string} filename - Suggested filename
 */
async function downloadFile(url, filename) {
  debugLog('DOWNLOAD', 'Starting download', { url, filename });

  try {
    // Create a temporary link and trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    document.body.appendChild(link);
    link.click();
    
    // Cleanup
    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);

    debugLog('DOWNLOAD', 'Download initiated', { filename });

  } catch (error) {
    errorLog('DOWNLOAD', 'Download failed', error, { url, filename });
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

/**
 * Trigger download for a processed file
 * Alias for compatibility with main.js
 * 
 * @param {string} processingId - Processing ID
 * @param {string} filename - Suggested filename
 */
async function triggerDownload(processingId, filename = 'statement.xlsx') {
  debugLog('TRIGGER_DOWNLOAD', 'Getting download URL', { processingId, filename });

  try {
    // Get the status to find the download URL
    const response = await fetch(`${API_BASE_URL}/api/status?id=${processingId}`);
    
    if (!response.ok) {
      throw new Error('Failed to get download URL');
    }

    const data = await response.json();
    
    if (!data.success || data.status !== 'completed') {
      throw new Error('File is not ready for download yet');
    }

    // Use direct download URL if available, otherwise construct it
    const downloadUrl = data.directDownloadUrl || data.downloadUrl || data.result?.url;
    
    if (!downloadUrl) {
      throw new Error('Download URL not found');
    }

    debugLog('TRIGGER_DOWNLOAD', 'Download URL found', { downloadUrl });

    // Trigger the download
    await downloadFile(downloadUrl, filename);

  } catch (error) {
    errorLog('TRIGGER_DOWNLOAD', 'Failed to trigger download', error, { processingId });
    throw error;
  }
}

/**
 * Get list of supported banks
 * Returns hardcoded list for now (can be made dynamic later)
 * 
 * @returns {Promise<{banks: Array}>}
 */
async function getBanks() {
  debugLog('GET_BANKS', 'Getting supported banks');

  // Return a list of common banks
  // In production, this could call an API endpoint
  const banks = [
    { bankId: 'bdo', bankName: 'BDO', country: 'PH' },
    { bankId: 'bpi', bankName: 'BPI', country: 'PH' },
    { bankId: 'metrobank', bankName: 'Metrobank', country: 'PH' },
    { bankId: 'unionbank', bankName: 'UnionBank', country: 'PH' },
    { bankId: 'security-bank', bankName: 'Security Bank', country: 'PH' },
    { bankId: 'rcbc', bankName: 'RCBC', country: 'PH' },
    { bankId: 'pnb', bankName: 'PNB', country: 'PH' },
    { bankId: 'landbank', bankName: 'Land Bank', country: 'PH' },
    { bankId: 'generic', bankName: 'Generic PDF', country: 'All' },
  ];

  debugLog('GET_BANKS', 'Returning banks', { count: banks.length });

  return { banks };
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * API Client instance
 */
const apiClient = {
  validateFile,
  convertFile,
  pollStatus,
  downloadFile,
  triggerDownload,
  getBanks,
  
  // Configuration getters
  getBaseUrl: () => API_BASE_URL,
  getPollInterval: () => POLL_INTERVAL,
  getMaxPollAttempts: () => MAX_POLL_ATTEMPTS,
};

// Export default and named exports
// IMPORTANT: Only export each function ONCE (not in function definition)
export default apiClient;

export {
  validateFile,
  convertFile,
  pollStatus,
  downloadFile,
  triggerDownload,
  getBanks,
  apiClient,
};
