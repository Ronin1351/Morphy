/**
 * Upload Handler - Manages file upload logic and state
 * Handles drag & drop, file selection, validation, and upload progress
 * 
 * @module upload
 */

import apiClient, { validateFile as validateFileAPI, convertFile, pollStatus } from './api.js';

/**
 * Upload Manager class
 */
class UploadManager {
  constructor() {
    this.files = [];
    this.currentUpload = null;
    this.processingId = null;
    this.listeners = {
      filesAdded: [],
      fileRemoved: [],
      uploadProgress: [],
      uploadComplete: [],
      uploadError: [],
      processingProgress: [],
      processingComplete: [],
      processingError: [],
    };
    
    this.state = {
      isUploading: false,
      isProcessing: false,
      uploadProgress: 0,
      processingProgress: 0,
      error: null,
    };
  }

  /**
   * Initialize upload manager with DOM elements
   * 
   * @param {Object} elements - DOM element references
   */
  init(elements = {}) {
    this.elements = {
      dropZone: elements.dropZone || document.getElementById('dropZone'),
      fileInput: elements.fileInput || document.getElementById('file'),
      browseBtn: elements.browseBtn || document.getElementById('browseBtn'),
      uploadList: elements.uploadList || document.getElementById('uploadList'),
      convertBtn: elements.convertBtn || document.getElementById('convertBtn'),
      form: elements.form || document.getElementById('convertForm'),
    };

    this.setupEventListeners();
  }

  /**
   * Setup DOM event listeners
   */
  setupEventListeners() {
    const { dropZone, fileInput, browseBtn, convertBtn, form } = this.elements;

    // Drag and drop events
    if (dropZone) {
      ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('dragover');
        });
      });

      dropZone.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer.files);
        this.handleFiles(files);
      });

      // Click to browse
      dropZone.addEventListener('click', (e) => {
        if (e.target === browseBtn || e.target.closest('.btn-text')) {
          return;
        }
        fileInput?.click();
      });
    }

    // Browse button
    if (browseBtn) {
      browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput?.click();
      });
    }

    // File input change
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        this.handleFiles(files);
      });
    }

    // Form submit (convert button)
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.startConversion();
      });
    }
  }

  /**
   * Handle selected/dropped files
   * 
   * @param {Array<File>} files - Array of File objects
   */
  handleFiles(files) {
    // Filter PDF files only
    const pdfFiles = files.filter(file => 
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    );

    if (pdfFiles.length === 0) {
      this.emit('uploadError', {
        code: 'NO_PDF_FILES',
        message: 'Please select PDF files only',
      });
      return;
    }

    // For now, only handle single file
    const file = pdfFiles[0];

    // Validate file
    const validation = validateFileAPI(file);
    
    if (!validation.valid) {
      this.emit('uploadError', {
        code: 'VALIDATION_FAILED',
        message: validation.errors[0]?.message || 'File validation failed',
        errors: validation.errors,
      });
      return;
    }

    // Show warnings if any
    if (validation.warnings.length > 0) {
      validation.warnings.forEach(warning => {
        console.warn('File warning:', warning);
      });
    }

    // Add file
    this.addFile(file);
  }

  /**
   * Add file to upload queue
   * 
   * @param {File} file - File to add
   */
  addFile(file) {
    // Clear existing files (single file mode)
    this.files = [];

    const fileInfo = {
      file,
      id: this.generateFileId(),
      name: file.name,
      size: file.size,
      type: file.type,
      addedAt: Date.now(),
      status: 'pending',
    };

    this.files.push(fileInfo);
    this.emit('filesAdded', this.files);
    this.updateConvertButton();
  }

  /**
   * Remove file from queue
   * 
   * @param {string} fileId - File ID to remove
   */
  removeFile(fileId) {
    const index = this.files.findIndex(f => f.id === fileId);
    
    if (index !== -1) {
      const removed = this.files.splice(index, 1)[0];
      this.emit('fileRemoved', removed);
      this.updateConvertButton();
    }
  }

  /**
   * Clear all files
   */
  clearFiles() {
    this.files = [];
    this.currentUpload = null;
    this.processingId = null;
    this.emit('filesAdded', this.files);
    this.updateConvertButton();
  }

  /**
   * Start conversion process
   * 
   * @param {Object} options - Conversion options
   */
  async startConversion(options = {}) {
    if (this.files.length === 0) {
      this.emit('uploadError', {
        code: 'NO_FILES',
        message: 'Please select a file first',
      });
      return;
    }

    if (this.state.isUploading || this.state.isProcessing) {
      console.warn('Upload or processing already in progress');
      return;
    }

    const fileInfo = this.files[0];
    const file = fileInfo.file;

    // Get conversion options from form or parameters
    const conversionOptions = {
      format: options.format || this.getSelectedFormat(),
      bankFormat: options.bankFormat || this.getSelectedBank(),
      includeSummary: options.includeSummary !== false,
      includeLog: options.includeLog !== false,
    };

    try {
      // Update state
      this.state.isUploading = true;
      this.state.uploadProgress = 0;
      this.state.error = null;
      fileInfo.status = 'uploading';

      // Upload file with progress tracking
      const result = await convertFile(
        file,
        conversionOptions,
        (progress) => {
          this.state.uploadProgress = progress;
          this.emit('uploadProgress', {
            progress,
            fileId: fileInfo.id,
          });
        }
      );

      // Upload complete, now processing
      this.state.isUploading = false;
      this.state.isProcessing = true;
      this.processingId = result.processingId;
      fileInfo.status = 'processing';
      fileInfo.processingId = result.processingId;

      this.emit('uploadComplete', {
        fileId: fileInfo.id,
        processingId: result.processingId,
      });

      // Poll for processing status
      await this.pollProcessingStatus(result.processingId, fileInfo);

    } catch (error) {
      this.state.isUploading = false;
      this.state.isProcessing = false;
      this.state.error = error;
      fileInfo.status = 'error';
      fileInfo.error = error.message;

      this.emit('uploadError', {
        code: error.code || 'UPLOAD_FAILED',
        message: error.message || 'Upload failed',
        details: error,
        fileId: fileInfo.id,
      });
    }
  }

  /**
   * Poll processing status until complete
   * 
   * @param {string} processingId - Processing ID
   * @param {Object} fileInfo - File information
   */
  async pollProcessingStatus(processingId, fileInfo) {
    try {
      const result = await pollStatus(
        processingId,
        (status) => {
          // Update progress
          this.state.processingProgress = status.progress || 0;
          fileInfo.processingStatus = status;

          this.emit('processingProgress', {
            fileId: fileInfo.id,
            processingId,
            status,
            progress: status.progress,
            currentStep: status.currentStep,
          });
        },
        60 // Max 2 minutes of polling (60 attempts x 2s)
      );

      // Processing complete
      this.state.isProcessing = false;
      fileInfo.status = 'completed';
      fileInfo.result = result;

      this.emit('processingComplete', {
        fileId: fileInfo.id,
        processingId,
        result,
      });

    } catch (error) {
      this.state.isProcessing = false;
      this.state.error = error;
      fileInfo.status = 'error';
      fileInfo.error = error.message;

      this.emit('processingError', {
        code: error.code || 'PROCESSING_FAILED',
        message: error.message || 'Processing failed',
        details: error,
        fileId: fileInfo.id,
        processingId,
      });
    }
  }

  /**
   * Get selected output format from form
   */
  getSelectedFormat() {
    const formatSelect = document.getElementById('format');
    return formatSelect?.value || 'xlsx';
  }

  /**
   * Get selected bank format from form
   */
  getSelectedBank() {
    const bankSelect = document.getElementById('bankFormat');
    return bankSelect?.value || null;
  }

  /**
   * Update convert button state
   */
  updateConvertButton() {
    const { convertBtn } = this.elements;
    
    if (convertBtn) {
      const hasFiles = this.files.length > 0;
      const isActive = this.state.isUploading || this.state.isProcessing;
      
      convertBtn.disabled = !hasFiles || isActive;

      if (isActive) {
        if (this.state.isUploading) {
          convertBtn.textContent = `Uploading... ${Math.round(this.state.uploadProgress)}%`;
        } else if (this.state.isProcessing) {
          convertBtn.textContent = `Processing... ${Math.round(this.state.processingProgress)}%`;
        }
      } else {
        convertBtn.textContent = 'Convert';
      }
    }
  }

  /**
   * Generate unique file ID
   */
  generateFileId() {
    return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
   * Get current state
   */
  getState() {
    return {
      ...this.state,
      files: this.files,
      currentUpload: this.currentUpload,
      processingId: this.processingId,
    };
  }

  /**
   * Get file by ID
   */
  getFile(fileId) {
    return this.files.find(f => f.id === fileId);
  }

  /**
   * Check if upload is in progress
   */
  isActive() {
    return this.state.isUploading || this.state.isProcessing;
  }

  /**
   * Event listener management
   */
  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  off(event, callback) {
    if (this.listeners[event]) {
      const index = this.listeners[event].indexOf(callback);
      if (index !== -1) {
        this.listeners[event].splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Reset manager state
   */
  reset() {
    this.clearFiles();
    this.state = {
      isUploading: false,
      isProcessing: false,
      uploadProgress: 0,
      processingProgress: 0,
      error: null,
    };
    this.updateConvertButton();
  }
}

// Create singleton instance
const uploadManager = new UploadManager();

// Export both class and instance
export { UploadManager };
export default uploadManager;

// Export convenience methods
export const init = (elements) => uploadManager.init(elements);
export const handleFiles = (files) => uploadManager.handleFiles(files);
export const addFile = (file) => uploadManager.addFile(file);
export const removeFile = (fileId) => uploadManager.removeFile(fileId);
export const clearFiles = () => uploadManager.clearFiles();
export const startConversion = (options) => uploadManager.startConversion(options);
export const getState = () => uploadManager.getState();
export const on = (event, callback) => uploadManager.on(event, callback);
export const off = (event, callback) => uploadManager.off(event, callback);
export const reset = () => uploadManager.reset();