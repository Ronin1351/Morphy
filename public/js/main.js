/**
 * Main Application Entry Point
 * Orchestrates all modules and initializes the application
 * 
 * @module main
 */

import uploadManager from './upload.js';
import apiClient, { triggerDownload, getBanks } from './api.js';

/**
 * Application class
 */
class App {
  constructor() {
    this.initialized = false;
    this.currentProcessingId = null;
    this.modal = null;
    this.toastContainer = null;
  }

  /**
   * Initialize application
   */
  async init() {
    if (this.initialized) {
      console.warn('App already initialized');
      return;
    }

    try {
      // Cache DOM elements
      this.cacheElements();

      // Initialize theme
      this.initTheme();

      // Initialize upload manager
      this.initUploadManager();

      // Setup event listeners
      this.setupEventListeners();

      // Load supported banks (optional)
      await this.loadBanks();

      // Check system health
      await this.checkHealth();

      // Show welcome toast
      this.toast('Welcome! Upload your PDF to get started.', 'info');

      this.initialized = true;
      console.log('App initialized successfully');

    } catch (error) {
      console.error('Failed to initialize app:', error);
      this.toast('Failed to initialize application', 'error');
    }
  }

  /**
   * Cache DOM elements
   */
  cacheElements() {
    // Core elements
    this.elements = {
      // Upload zone
      dropZone: document.getElementById('dropZone'),
      fileInput: document.getElementById('file'),
      uploadList: document.querySelector('.upload-list'),
      
      // Form
      form: document.getElementById('convertForm'),
      formatSelect: document.getElementById('format'),
      bankSelect: document.getElementById('bankFormat'),
      convertBtn: document.getElementById('convertBtn'),
      
      // Modal
      modal: document.getElementById('modal'),
      modalOverlay: document.getElementById('modalOverlay'),
      modalTitle: document.getElementById('modalTitle'),
      modalMessage: document.getElementById('modalMessage'),
      modalClose: document.querySelector('[data-close]'),
      progressFill: document.getElementById('progressFill'),
      downloadLink: document.getElementById('downloadLink'),
      
      // Theme
      themeBtn: document.getElementById('themeBtn'),
      themeOptions: document.querySelectorAll('.theme-option'),
      
      // Toast
      toastContainer: document.getElementById('toastContainer'),
      
      // Palette
      paletteItems: document.querySelectorAll('.palette-item'),
      copyBtns: document.querySelectorAll('.copy-btn'),
    };

    this.modal = this.elements.modal;
    this.toastContainer = this.elements.toastContainer;
  }

  /**
   * Initialize theme system
   */
  initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'auto';
    this.setTheme(savedTheme, true);

    // Theme toggle button
    if (this.elements.themeBtn) {
      this.elements.themeBtn.addEventListener('click', () => {
        this.toggleTheme();
      });
    }

    // Theme option buttons
    this.elements.themeOptions?.forEach(option => {
      option.addEventListener('click', () => {
        const theme = option.dataset.theme;
        this.setTheme(theme);
      });
    });
  }

  /**
   * Set theme
   */
  setTheme(theme, skipToast = false) {
    document.body.dataset.theme = theme;
    localStorage.setItem('theme', theme);

    // Update active theme option
    this.elements.themeOptions?.forEach(option => {
      if (option.dataset.theme === theme) {
        option.classList.add('active');
      } else {
        option.classList.remove('active');
      }
    });

    if (!skipToast) {
      this.toast(`Theme: ${theme}`, 'info');
    }
  }

  /**
   * Toggle theme
   */
  toggleTheme() {
    const current = document.body.dataset.theme || 'auto';
    const next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
    this.setTheme(next);
  }

  /**
   * Initialize upload manager
   */
  initUploadManager() {
    uploadManager.init(this.elements);

    // Subscribe to upload events
    uploadManager.on('filesAdded', (files) => {
      this.handleFilesAdded(files);
    });

    uploadManager.on('fileRemoved', (file) => {
      this.handleFileRemoved(file);
    });

    uploadManager.on('uploadProgress', (data) => {
      this.handleUploadProgress(data);
    });

    uploadManager.on('uploadComplete', (data) => {
      this.handleUploadComplete(data);
    });

    uploadManager.on('processingProgress', (data) => {
      this.handleProcessingProgress(data);
    });

    uploadManager.on('processingComplete', (data) => {
      this.handleProcessingComplete(data);
    });

    uploadManager.on('uploadError', (error) => {
      this.handleError(error);
    });

    uploadManager.on('processingError', (error) => {
      this.handleError(error);
    });
  }

  /**
   * Setup additional event listeners
   */
  setupEventListeners() {
    // Modal close
    this.elements.modalClose?.addEventListener('click', () => {
      this.closeModal();
    });

    this.elements.modalOverlay?.addEventListener('click', (e) => {
      if (e.target === this.elements.modalOverlay) {
        this.closeModal();
      }
    });

    // ESC to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal && !this.modal.hidden) {
        this.closeModal();
      }
    });

    // Palette copy buttons
    this.elements.copyBtns?.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const paletteItem = btn.closest('.palette-item');
        const hex = paletteItem?.dataset.hex;
        
        if (hex) {
          this.copyToClipboard(hex);
        }
      });
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', (e) => {
        const href = anchor.getAttribute('href');
        if (href === '#') return;
        
        e.preventDefault();
        const target = document.querySelector(href);
        
        if (target) {
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
        }
      });
    });
  }

  /**
   * Load supported banks into dropdown
   */
  async loadBanks() {
    try {
      const { banks } = await getBanks();
      
      if (this.elements.bankSelect && banks) {
        // Clear existing options (except first one)
        while (this.elements.bankSelect.options.length > 1) {
          this.elements.bankSelect.remove(1);
        }

        // Add bank options
        banks.forEach(bank => {
          const option = document.createElement('option');
          option.value = bank.bankId;
          option.textContent = `${bank.bankName} (${bank.country})`;
          this.elements.bankSelect.appendChild(option);
        });
      }
    } catch (error) {
      console.warn('Failed to load banks:', error);
      // Non-critical error, continue without bank list
    }
  }

  /**
   * Check system health and configuration
   */
  async checkHealth() {
    try {
      const response = await fetch('/api/health');
      const health = await response.json();

      console.log('[HEALTH CHECK]', health);

      // Show warnings if configuration issues exist
      if (health.errors && health.errors.length > 0) {
        health.errors.forEach(error => {
          console.error('[CONFIG ERROR]', error);

          // Show user-friendly message
          if (error.code === 'BLOB_TOKEN_MISSING') {
            this.showConfigurationWarning(
              'Configuration Required',
              'File uploads require Vercel Blob Storage to be configured. Please contact the administrator to set up BLOB_READ_WRITE_TOKEN in the Vercel Dashboard.',
              'warning'
            );
          }
        });
      }

      if (health.warnings && health.warnings.length > 0) {
        health.warnings.forEach(warning => {
          console.warn('[CONFIG WARNING]', warning);
        });
      }

    } catch (error) {
      console.warn('Health check failed:', error);
      // Non-critical error, continue without health check
    }
  }

  /**
   * Show configuration warning banner
   */
  showConfigurationWarning(title, message, type = 'warning') {
    // Create a warning banner at the top of the page
    const banner = document.createElement('div');
    banner.className = 'config-warning';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: ${type === 'error' ? '#dc2626' : '#f59e0b'};
      color: white;
      padding: 12px 20px;
      text-align: center;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      font-size: 14px;
      line-height: 1.5;
    `;

    banner.innerHTML = `
      <strong>${title}:</strong> ${message}
      <button onclick="this.parentElement.remove()" style="
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        color: white;
        padding: 4px 12px;
        margin-left: 12px;
        cursor: pointer;
        border-radius: 4px;
        font-size: 12px;
      ">Dismiss</button>
    `;

    document.body.insertBefore(banner, document.body.firstChild);

    // Also adjust body padding to account for banner
    document.body.style.paddingTop = '50px';
  }

  /**
   * Handle files added
   */
  handleFilesAdded(files) {
    if (!this.elements.uploadList) return;

    // Render file list
    this.elements.uploadList.innerHTML = files.map(file => `
      <div class="file-item" data-file-id="${file.id}">
        <div class="file-info">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div>
            <div class="file-name">${this.escapeHtml(file.name)}</div>
            <div class="file-size">${uploadManager.formatFileSize(file.size)}</div>
          </div>
        </div>
        <button class="btn-ghost" onclick="app.removeFile('${file.id}')" aria-label="Remove file">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `).join('');

    this.toast(`${files.length} file(s) added`, 'success');
  }

  /**
   * Handle file removed
   */
  handleFileRemoved(file) {
    const fileItem = document.querySelector(`[data-file-id="${file.id}"]`);
    if (fileItem) {
      fileItem.remove();
    }
    this.toast('File removed', 'info');
  }

  /**
   * Handle upload progress
   */
  handleUploadProgress({ progress }) {
    if (this.elements.convertBtn) {
      this.elements.convertBtn.textContent = `Uploading... ${Math.round(progress)}%`;
    }
  }

  /**
   * Handle upload complete
   */
  handleUploadComplete({ processingId }) {
    this.currentProcessingId = processingId;
    this.openModal('Converting Your Documents', 'Processing file...');
  }

  /**
   * Handle processing progress
   */
  handleProcessingProgress({ status, progress }) {
    if (this.elements.progressFill) {
      this.elements.progressFill.style.width = `${progress}%`;
    }

    if (this.elements.modalMessage) {
      this.elements.modalMessage.textContent = status.currentStep || 'Processing...';
    }

    if (this.elements.convertBtn) {
      this.elements.convertBtn.textContent = `Processing... ${Math.round(progress)}%`;
    }
  }

  /**
   * Handle processing complete
   */
  handleProcessingComplete({ result }) {
    this.currentProcessingId = result.processingId;

    // Update modal for download
    if (this.elements.modalTitle) {
      this.elements.modalTitle.textContent = 'Conversion Complete!';
    }

    if (this.elements.modalMessage) {
      const summary = result.summary || {};
      this.elements.modalMessage.innerHTML = `
        <p><strong>Your file is ready!</strong></p>
        <p>Transactions processed: ${summary.totalTransactions || 0}</p>
        <p>Format: ${result.outputFile?.format?.toUpperCase() || 'XLSX'}</p>
      `;
    }

    // Setup download link
    if (this.elements.downloadLink) {
      this.elements.downloadLink.onclick = async (e) => {
        e.preventDefault();
        await this.downloadFile(result.processingId, result.outputFile?.filename);
      };
    }

    // Reset convert button
    if (this.elements.convertBtn) {
      this.elements.convertBtn.textContent = 'Convert';
      this.elements.convertBtn.disabled = false;
    }

    this.toast('Conversion complete!', 'success');
  }

  /**
   * Handle error
   */
  handleError(error) {
    console.error('Error:', error);
    
    this.closeModal();
    
    // Reset convert button
    if (this.elements.convertBtn) {
      this.elements.convertBtn.textContent = 'Convert';
      this.elements.convertBtn.disabled = false;
    }

    this.toast(error.message || 'An error occurred', 'error');
  }

  /**
   * Download file
   */
  async downloadFile(processingId, filename = 'statement.xlsx') {
    try {
      this.toast('Starting download...', 'info');
      await triggerDownload(processingId, filename);
      this.toast('Download complete!', 'success');
      this.closeModal();
      
      // Reset after successful download
      setTimeout(() => {
        uploadManager.reset();
        this.handleFilesAdded([]);
      }, 1000);
      
    } catch (error) {
      console.error('Download failed:', error);
      this.toast('Download failed', 'error');
    }
  }

  /**
   * Remove file (exposed for onclick handlers)
   */
  removeFile(fileId) {
    uploadManager.removeFile(fileId);
  }

  /**
   * Open modal
   */
  openModal(title, message) {
    if (!this.elements.modalOverlay) return;

    if (this.elements.modalTitle) {
      this.elements.modalTitle.textContent = title;
    }

    if (this.elements.modalMessage) {
      this.elements.modalMessage.textContent = message;
    }

    if (this.elements.progressFill) {
      this.elements.progressFill.style.width = '0%';
    }

    this.elements.modalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Focus modal for accessibility
    if (this.modal) {
      this.modal.focus();
    }
  }

  /**
   * Close modal
   */
  closeModal() {
    if (!this.elements.modalOverlay) return;

    this.elements.modalOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  /**
   * Show toast notification
   */
  toast(message, type = 'info') {
    if (!this.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type} clay`;

    const icons = {
      success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    toast.innerHTML = `
      ${icons[type] || icons.info}
      <span>${this.escapeHtml(message)}</span>
    `;

    this.toastContainer.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = 'toastSlideIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Copy text to clipboard
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.toast(`Copied ${text}`, 'success');
    } catch (error) {
      console.error('Failed to copy:', error);
      this.toast('Failed to copy', 'error');
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      initialized: this.initialized,
      currentProcessingId: this.currentProcessingId,
      uploadState: uploadManager.getState(),
    };
  }
}

// Create app instance
const app = new App();

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    app.init();
  });
} else {
  app.init();
}

// Export app instance
export default app;

// Make app available globally for onclick handlers
window.app = app;