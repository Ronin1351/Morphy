/**
 * API Client - FIXED VERSION with comprehensive error handling
 * Handles all HTTP requests to serverless functions
 */

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || '/api';
const DEFAULT_TIMEOUT = 60000; // Increased to 60 seconds
const POLL_INTERVAL = 2000;
const DEBUG = true; // Enable debugging

/**
 * Debug logger
 */
function debugLog(message, data = null) {
  if (DEBUG) {
    console.log(`[API] ${new Date().toISOString()} - ${message}`, data || '');
  }
}

/**
 * API Client class
 */
class APIClient {
  constructor(baseURL = API_BASE_URL) {
    this.baseURL = baseURL;
    this.defaultHeaders = {
      'Accept': 'application/json',
    };
    debugLog('APIClient initialized', { baseURL });
  }

  /**
   * Make HTTP request with enhanced error handling
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    debugLog('Making request', { url, method: options.method || 'GET' });
    
    const config = {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers,
      },
    };

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => {
        debugLog('Request timeout', { url, timeout: options.timeout || DEFAULT_TIMEOUT });
        controller.abort();
      },
      options.timeout || DEFAULT_TIMEOUT
    );
    config.signal = controller.signal;

    try {
      debugLog('Fetching...', { url });
      const response = await fetch(url, config);
      clearTimeout(timeoutId);

      debugLog('Response received', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
      });

      // Handle non-JSON responses (like file downloads)
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('application/json')) {
        debugLog('Non-JSON response, returning blob');
        return {
          ok: response.ok,
          status: response.status,
          data: await response.blob(),
          headers: response.headers,
        };
      }

      // Parse JSON response
      let data;
      try {
        const text = await response.text();
        debugLog('Response text length', { length: text.length });
        
        if (!text) {
          throw new Error('Empty response body');
        }
        
        data = JSON.parse(text);
        debugLog('JSON parsed successfully', {
          success: data.success,
          hasError: !!data.error,
        });
      } catch (parseError) {
        debugLog('ERROR: JSON parse failed', {
          error: parseError.message,
          status: response.status,
        });
        
        throw new APIError(
          'Invalid JSON response from server',
          response.status,
          'PARSE_ERROR',
          { parseError: parseError.message }
        );
      }

      if (!response.ok) {
        const errorMessage = data.error?.message || data.message || 'Request failed';
        const errorCode = data.error?.code || 'REQUEST_FAILED';
        const errorDetails = data.error?.details || data.details;
        
        debugLog('ERROR: Request failed', {
          status: response.status,
          code: errorCode,
          message: errorMessage,
          details: errorDetails,
        });

        throw new APIError(
          errorMessage,
          response.status,
          errorCode,
          data
        );
      }

      return data;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        debugLog('ERROR: Request aborted (timeout)');
        throw new APIError('Request timeout - server took too long to respond', 408, 'TIMEOUT');
      }

      if (error instanceof APIError) {
        throw error;
      }

      // Network error or other fetch error
      debugLog('ERROR: Network or fetch error', {
        name: error.name,
        message: error.message,
      });

      throw new APIError(
        error.message || 'Network error - please check your connection',
        0,
        'NETWORK_ERROR',
        { originalError: error.message }
      );
    }
  }

  /**
   * POST request with enhanced logging
   */
  async post(endpoint, body, options = {}) {
    debugLog('POST request', { endpoint });
    
    const config = {
      method: 'POST',
      ...options,
    };

    // Handle FormData (for file uploads)
    if (body instanceof FormData) {
      config.body = body;
      debugLog('Sending FormData', {
        hasFile: body.has('file'),
        keys: Array.from(body.keys()),
      });
      // Don't set Content-Type for FormData, let browser set it with boundary
    } else {
      config.headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };
      config.body = JSON.stringify(body);
      debugLog('Sending JSON body');
    }

    return this.request(endpoint, config);
  }

  /**
   * Convert PDF to Excel with progress tracking
   */
  async convertFile(file, options = {}, onProgress = null) {
    debugLog('convertFile called', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      options,
    });

    // Validate file before upload
    const validation = this.validateFile(file);
    if (!validation.valid) {
      debugLog('ERROR: File validation failed', validation.errors);
      const error = new APIError(
        validation.errors[0]?.message || 'File validation failed',
        400,
        validation.errors[0]?.code || 'VALIDATION_ERROR',
        { validation }
      );
      throw error;
    }

    if (validation.warnings.length > 0) {
      debugLog('File validation warnings', validation.warnings);
    }

    const formData = new FormData();
    formData.append('file', file);
    
    // Add options
    if (options.bankFormat) {
      formData.append('bank_name', options.bankFormat);
    }
    if (options.format) {
      formData.append('format', options.format);
    }
    if (options.includeSummary !== undefined) {
      formData.append('include_summary', options.includeSummary.toString());
    }
    if (options.includeLog !== undefined) {
      formData.append('include_log', options.includeLog.toString());
    }
    if (options.validateOnly) {
      formData.append('validate_only', 'true');
    }

    debugLog('FormData prepared', {
      bankFormat: options.bankFormat,
      format: options.format,
    });

    // Upload with progress tracking
    if (onProgress && typeof XMLHttpRequest !== 'undefined') {
      debugLog('Using XMLHttpRequest for progress tracking');
      return this.uploadWithProgress('/convert', formData, onProgress);
    }

    debugLog('Using fetch (no progress tracking)');
    return this.post('/convert', formData, { timeout: 120000 }); // 2 minute timeout for conversion
  }

  /**
   * Upload file with progress tracking using XMLHttpRequest
   */
  uploadWithProgress(endpoint, formData, onProgress) {
    return new Promise((resolve, reject) => {
      debugLog('Starting upload with progress tracking', { endpoint });
      const xhr = new XMLHttpRequest();

      // Progress tracking
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          debugLog('Upload progress', {
            loaded: e.loaded,
            total: e.total,
            percent: percentComplete.toFixed(2),
          });
          onProgress(percentComplete);
        }
      });

      // Load (success or error response)
      xhr.addEventListener('load', () => {
        debugLog('Upload complete', {
          status: xhr.status,
          statusText: xhr.statusText,
        });

        try {
          const response = JSON.parse(xhr.responseText);
          debugLog('Response parsed', { success: response.success });
          
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(response);
          } else {
            const error = new APIError(
              response.error?.message || response.message || 'Upload failed',
              xhr.status,
              response.error?.code || 'UPLOAD_FAILED',
              response
            );
            debugLog('ERROR: Upload failed with error response', {
              code: error.code,
              message: error.message,
            });
            reject(error);
          }
        } catch (parseError) {
          debugLog('ERROR: Failed to parse response', {
            error: parseError.message,
            responseText: xhr.responseText.substring(0, 200),
          });
          
          reject(new APIError(
            'Invalid response from server',
            xhr.status,
            'PARSE_ERROR',
            { parseError: parseError.message }
          ));
        }
      });

      // Network error
      xhr.addEventListener('error', () => {
        debugLog('ERROR: Network error during upload');
        reject(new APIError(
          'Network error during upload - please check your connection',
          0,
          'NETWORK_ERROR'
        ));
      });

      // Upload aborted
      xhr.addEventListener('abort', () => {
        debugLog('Upload aborted');
        reject(new APIError('Upload cancelled by user', 0, 'CANCELLED'));
      });

      // Timeout
      xhr.addEventListener('timeout', () => {
        debugLog('ERROR: Upload timeout');
        reject(new APIError('Upload timeout - server took too long to respond', 408, 'TIMEOUT'));
      });

      // Send request
      const url = `${this.baseURL}${endpoint}`;
      debugLog('Opening XHR connection', { url });
      xhr.open('POST', url);
      xhr.timeout = 120000; // 2 minute timeout
      xhr.send(formData);
    });
  }

  /**
   * Validate file before upload
   */
  validateFile(file) {
    debugLog('Validating file', {
      name: file.name,
      size: file.size,
      type: file.type,
    });

    const errors = [];
    const warnings = [];

    // Check file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      errors.push({
        code: 'INVALID_FILE_TYPE',
        message: `Invalid file type: "${file.type}". Only PDF files are supported.`,
      });
    }

    // Check file size (50MB limit)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      errors.push({
        code: 'FILE_TOO_LARGE',
        message: `File size (${this.formatFileSize(file.size)}) exceeds maximum allowed size (50MB)`,
      });
    }

    // Check if file is empty
    if (file.size === 0) {
      errors.push({
        code: 'EMPTY_FILE',
        message: 'File is empty (0 bytes)',
      });
    }

    // Warn if file is very large
    if (file.size > 10 * 1024 * 1024 && file.size <= maxSize) {
      warnings.push({
        code: 'LARGE_FILE',
        message: 'Large file may take longer to process (>10MB)',
      });
    }

    const result = {
      valid: errors.length === 0,
      errors,
      warnings,
    };

    debugLog('Validation result', result);
    return result;
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Custom API Error class with detailed information
 */
class APIError extends Error {
  constructor(message, statusCode, code, details = null) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    
    // Log error details
    debugLog('APIError created', {
      code,
      statusCode,
      message,
      hasDetails: !!details,
    });
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
    };
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage() {
    // Map technical errors to user-friendly messages
    const userMessages = {
      'NO_FILE_PROVIDED': 'Please select a PDF file to upload.',
      'INVALID_FILE_TYPE': 'Only PDF files are supported. Please select a PDF file.',
      'FILE_TOO_LARGE': 'File is too large. Maximum size is 50MB.',
      'EMPTY_FILE': 'The selected file is empty. Please choose a valid PDF.',
      'TIMEOUT': 'Request timed out. Please try again.',
      'NETWORK_ERROR': 'Network error. Please check your connection and try again.',
      'PARSE_ERROR': 'Server response error. Please try again.',
      'UPLOAD_FAILED': 'Upload failed. Please try again.',
      'PROCESSING_FAILED': 'Processing failed. Please check the file and try again.',
    };

    return userMessages[this.code] || this.message || 'An unexpected error occurred.';
  }
}

// Create singleton instance
const apiClient = new APIClient();

// Export both class and instance
export { APIClient, APIError };
export default apiClient;

// Export convenience methods with logging
export const convertFile = (file, options, onProgress) => {
  debugLog('convertFile wrapper called');
  return apiClient.convertFile(file, options, onProgress);
};

export const validateFile = (file) => {
  debugLog('validateFile wrapper called');
  return apiClient.validateFile(file);
};
