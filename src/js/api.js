/**
 * API Client - Frontend interface to backend API
 * Handles all HTTP requests to serverless functions
 * 
 * @module api
 */

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || '/api';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const POLL_INTERVAL = 2000; // 2 seconds for status polling

/**
 * API Client class
 */
class APIClient {
  constructor(baseURL = API_BASE_URL) {
    this.baseURL = baseURL;
    this.defaultHeaders = {
      'Accept': 'application/json',
    };
  }

  /**
   * Make HTTP request
   * 
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>}
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    
    const config = {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options.headers,
      },
    };

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || DEFAULT_TIMEOUT);
    config.signal = controller.signal;

    try {
      const response = await fetch(url, config);
      clearTimeout(timeoutId);

      // Handle non-JSON responses (like file downloads)
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('application/json')) {
        return {
          ok: response.ok,
          status: response.status,
          data: await response.blob(),
          headers: response.headers,
        };
      }

      // Parse JSON response
      const data = await response.json();

      if (!response.ok) {
        throw new APIError(
          data.error?.message || 'Request failed',
          response.status,
          data.error?.code,
          data
        );
      }

      return data;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new APIError('Request timeout', 408, 'TIMEOUT');
      }

      if (error instanceof APIError) {
        throw error;
      }

      throw new APIError(
        error.message || 'Network error',
        0,
        'NETWORK_ERROR'
      );
    }
  }

  /**
   * GET request
   */
  async get(endpoint, params = {}) {
    const queryString = new URLSearchParams(params).toString();
    const url = queryString ? `${endpoint}?${queryString}` : endpoint;
    
    return this.request(url, {
      method: 'GET',
    });
  }

  /**
   * POST request
   */
  async post(endpoint, body, options = {}) {
    const config = {
      method: 'POST',
      ...options,
    };

    // Handle FormData (for file uploads)
    if (body instanceof FormData) {
      config.body = body;
      // Don't set Content-Type for FormData, let browser set it with boundary
    } else {
      config.headers = {
        'Content-Type': 'application/json',
        ...options.headers,
      };
      config.body = JSON.stringify(body);
    }

    return this.request(endpoint, config);
  }

  /**
   * Convert PDF to Excel
   * 
   * @param {File} file - PDF file
   * @param {Object} options - Conversion options
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>}
   */
  async convertFile(file, options = {}, onProgress = null) {
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

    // Upload with progress tracking
    if (onProgress && typeof XMLHttpRequest !== 'undefined') {
      return this.uploadWithProgress('/convert', formData, onProgress);
    }

    return this.post('/convert', formData);
  }

  /**
   * Upload file with progress tracking using XMLHttpRequest
   * 
   * @param {string} endpoint - API endpoint
   * @param {FormData} formData - Form data with file
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>}
   */
  uploadWithProgress(endpoint, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Progress tracking
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          onProgress(percentComplete);
        }
      });

      // Load (success)
      xhr.addEventListener('load', () => {
        try {
          const response = JSON.parse(xhr.responseText);
          
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(response);
          } else {
            reject(new APIError(
              response.error?.message || 'Upload failed',
              xhr.status,
              response.error?.code,
              response
            ));
          }
        } catch (error) {
          reject(new APIError('Invalid response', xhr.status, 'PARSE_ERROR'));
        }
      });

      // Error
      xhr.addEventListener('error', () => {
        reject(new APIError('Upload failed', 0, 'NETWORK_ERROR'));
      });

      // Abort
      xhr.addEventListener('abort', () => {
        reject(new APIError('Upload cancelled', 0, 'CANCELLED'));
      });

      // Send request
      xhr.open('POST', `${this.baseURL}${endpoint}`);
      xhr.send(formData);
    });
  }

  /**
   * Get processing status
   * 
   * @param {string} processingId - Processing ID
   * @returns {Promise<Object>}
   */
  async getStatus(processingId) {
    return this.get(`/status/${processingId}`);
  }

  /**
   * Poll for status until complete
   * 
   * @param {string} processingId - Processing ID
   * @param {Function} onUpdate - Status update callback
   * @param {number} maxAttempts - Maximum polling attempts (default: 60)
   * @returns {Promise<Object>}
   */
  async pollStatus(processingId, onUpdate = null, maxAttempts = 60) {
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const status = await this.getStatus(processingId);

        if (onUpdate) {
          onUpdate(status);
        }

        // Check if processing is complete
        if (status.status === 'completed' || status.status === 'error') {
          return status;
        }

        // Wait before next poll
        await this.sleep(POLL_INTERVAL);
        attempts++;

      } catch (error) {
        // If status not found, it might be too early, try again
        if (error.statusCode === 404 && attempts < 5) {
          await this.sleep(POLL_INTERVAL);
          attempts++;
          continue;
        }
        throw error;
      }
    }

    throw new APIError('Polling timeout', 408, 'TIMEOUT');
  }

  /**
   * Download converted file
   * 
   * @param {string} processingId - Processing ID
   * @param {string} method - Download method ('stream' or 'redirect')
   * @returns {Promise<Blob>}
   */
  async downloadFile(processingId, method = 'stream') {
    const endpoint = method === 'redirect' 
      ? `/download/${processingId}?method=redirect`
      : `/download/${processingId}`;

    if (method === 'redirect') {
      // For redirect method, just return the URL
      return `${this.baseURL}${endpoint}`;
    }

    // For stream method, fetch and return blob
    const response = await this.request(endpoint, {
      method: 'GET',
    });

    return response.data; // Returns blob
  }

  /**
   * Trigger file download in browser
   * 
   * @param {string} processingId - Processing ID
   * @param {string} filename - Filename for download
   */
  async triggerDownload(processingId, filename = 'statement.xlsx') {
    try {
      const blob = await this.downloadFile(processingId, 'stream');
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error('Download failed:', error);
      throw error;
    }
  }

  /**
   * Get supported banks
   * 
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>}
   */
  async getBanks(filters = {}) {
    return this.get('/banks', filters);
  }

  /**
   * Get specific bank details
   * 
   * @param {string} bankId - Bank ID
   * @returns {Promise<Object>}
   */
  async getBank(bankId) {
    return this.get('/banks', { id: bankId });
  }

  /**
   * Search banks
   * 
   * @param {string} query - Search query
   * @returns {Promise<Object>}
   */
  async searchBanks(query) {
    return this.get('/banks', { search: query });
  }

  /**
   * Get banks by country
   * 
   * @param {string} countryCode - Country code (e.g., 'US', 'PH')
   * @returns {Promise<Object>}
   */
  async getBanksByCountry(countryCode) {
    return this.get('/banks', { country: countryCode });
  }

  /**
   * Validate file before upload
   * 
   * @param {File} file - File to validate
   * @returns {Object}
   */
  validateFile(file) {
    const errors = [];
    const warnings = [];

    // Check file type
    if (!file.type.includes('pdf')) {
      errors.push({
        code: 'INVALID_FILE_TYPE',
        message: 'Only PDF files are supported',
      });
    }

    // Check file size (50MB limit)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      errors.push({
        code: 'FILE_TOO_LARGE',
        message: `File size (${this.formatFileSize(file.size)}) exceeds maximum (50MB)`,
      });
    }

    // Check if file is empty
    if (file.size === 0) {
      errors.push({
        code: 'EMPTY_FILE',
        message: 'File is empty',
      });
    }

    // Warn if file is very large
    if (file.size > 10 * 1024 * 1024) {
      warnings.push({
        code: 'LARGE_FILE',
        message: 'Large file may take longer to process',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Helper: Format file size
   */
  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * Helper: Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Custom API Error class
 */
class APIError extends Error {
  constructor(message, statusCode, code, details = null) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      code: this.code,
      details: this.details,
    };
  }
}

// Create singleton instance
const apiClient = new APIClient();

// Export both class and instance
export { APIClient, APIError };
export default apiClient;

// Export convenience methods
export const convertFile = (file, options, onProgress) => 
  apiClient.convertFile(file, options, onProgress);

export const getStatus = (processingId) => 
  apiClient.getStatus(processingId);

export const pollStatus = (processingId, onUpdate, maxAttempts) => 
  apiClient.pollStatus(processingId, onUpdate, maxAttempts);

export const downloadFile = (processingId, method) => 
  apiClient.downloadFile(processingId, method);

export const triggerDownload = (processingId, filename) => 
  apiClient.triggerDownload(processingId, filename);

export const getBanks = (filters) => 
  apiClient.getBanks(filters);

export const getBank = (bankId) => 
  apiClient.getBank(bankId);

export const searchBanks = (query) => 
  apiClient.searchBanks(query);

export const validateFile = (file) => 
  apiClient.validateFile(file);