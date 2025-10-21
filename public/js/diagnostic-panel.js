/**
 * Diagnostic Panel - Debug UI Component
 * Shows real-time system status and errors
 * Add this to your HTML page for debugging
 */

class DiagnosticPanel {
  constructor() {
    this.logs = [];
    this.maxLogs = 100;
    this.isVisible = false;
    this.panel = null;
    this.init();
  }

  init() {
    // Create panel HTML
    this.createPanel();
    
    // Intercept console.log
    this.interceptConsole();
    
    // Keyboard shortcut (Ctrl+Shift+D) to toggle
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        this.toggle();
      }
    });

    // Auto-open on errors
    window.addEventListener('error', (e) => {
      this.logError('Global Error', e.error || e.message);
      this.show();
    });

    window.addEventListener('unhandledrejection', (e) => {
      this.logError('Unhandled Promise Rejection', e.reason);
      this.show();
    });
  }

  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'diagnostic-panel';
    panel.style.cssText = `
      position: fixed;
      bottom: 0;
      right: 0;
      width: 600px;
      max-height: 400px;
      background: #1a1a1a;
      color: #00ff00;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      border: 2px solid #00ff00;
      border-bottom: none;
      border-right: none;
      display: none;
      flex-direction: column;
      z-index: 999999;
      box-shadow: 0 -4px 20px rgba(0,255,0,0.3);
    `;

    panel.innerHTML = `
      <div style="padding: 10px; background: #0a0a0a; border-bottom: 1px solid #00ff00; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 15px;">
          <strong>🔧 DIAGNOSTIC PANEL</strong>
          <span id="diag-status" style="color: #ffff00;">●</span>
          <span id="diag-time" style="color: #888;">--:--:--</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button id="diag-test-api" style="background: #003300; color: #00ff00; border: 1px solid #00ff00; padding: 4px 8px; cursor: pointer; font-family: inherit; font-size: 11px;">
            Test API
          </button>
          <button id="diag-check-env" style="background: #003300; color: #00ff00; border: 1px solid #00ff00; padding: 4px 8px; cursor: pointer; font-family: inherit; font-size: 11px;">
            Check ENV
          </button>
          <button id="diag-clear" style="background: #330000; color: #ff0000; border: 1px solid #ff0000; padding: 4px 8px; cursor: pointer; font-family: inherit; font-size: 11px;">
            Clear
          </button>
          <button id="diag-close" style="background: #222; color: #fff; border: 1px solid #555; padding: 4px 8px; cursor: pointer; font-family: inherit; font-size: 11px;">
            ✕
          </button>
        </div>
      </div>
      <div id="diag-env" style="padding: 8px; background: #0d0d0d; border-bottom: 1px solid #333; font-size: 11px; display: none; color: #00cccc;">
        <strong>Environment Status:</strong>
        <div id="diag-env-content" style="margin-top: 5px;"></div>
      </div>
      <div id="diag-logs" style="flex: 1; overflow-y: auto; padding: 10px; line-height: 1.4;">
        <div style="color: #888;">Press Ctrl+Shift+D to toggle panel | Logs will appear here...</div>
      </div>
    `;

    document.body.appendChild(panel);
    this.panel = panel;

    // Setup button handlers
    document.getElementById('diag-close').addEventListener('click', () => this.hide());
    document.getElementById('diag-clear').addEventListener('click', () => this.clearLogs());
    document.getElementById('diag-test-api').addEventListener('click', () => this.testAPI());
    document.getElementById('diag-check-env').addEventListener('click', () => this.checkEnvironment());

    // Update time
    setInterval(() => {
      document.getElementById('diag-time').textContent = new Date().toLocaleTimeString();
    }, 1000);

    this.log('Diagnostic panel initialized', 'system');
  }

  interceptConsole() {
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args) => {
      this.log(args.join(' '), 'log');
      originalLog.apply(console, args);
    };

    console.error = (...args) => {
      this.log(args.join(' '), 'error');
      originalError.apply(console, args);
    };

    console.warn = (...args) => {
      this.log(args.join(' '), 'warn');
      originalWarn.apply(console, args);
    };
  }

  log(message, type = 'log') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      message,
      type,
      time: Date.now(),
    };

    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.renderLog(logEntry);
  }

  logError(title, error) {
    const message = typeof error === 'object' 
      ? `${title}: ${error.message || error}\n${error.stack || ''}` 
      : `${title}: ${error}`;
    this.log(message, 'error');
  }

  renderLog(entry) {
    const logsContainer = document.getElementById('diag-logs');
    if (!logsContainer) return;

    const colors = {
      log: '#00ff00',
      error: '#ff0000',
      warn: '#ffff00',
      info: '#00ccff',
      success: '#00ff00',
      system: '#ff00ff',
    };

    const logDiv = document.createElement('div');
    logDiv.style.cssText = `
      margin-bottom: 5px;
      padding: 4px;
      background: ${entry.type === 'error' ? '#220000' : entry.type === 'warn' ? '#222200' : 'transparent'};
      border-left: 2px solid ${colors[entry.type] || colors.log};
      padding-left: 8px;
    `;

    logDiv.innerHTML = `
      <span style="color: #666;">[${entry.timestamp}]</span>
      <span style="color: ${colors[entry.type] || colors.log};">
        ${this.escapeHtml(entry.message)}
      </span>
    `;

    logsContainer.appendChild(logDiv);
    
    // Auto-scroll to bottom
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  clearLogs() {
    this.logs = [];
    const logsContainer = document.getElementById('diag-logs');
    if (logsContainer) {
      logsContainer.innerHTML = '<div style="color: #888;">Logs cleared...</div>';
    }
    this.log('Logs cleared', 'system');
  }

  async testAPI() {
    this.log('Testing API connection...', 'info');
    
    try {
      // Test 1: Health check
      this.log('Test 1: Checking API endpoint...', 'info');
      const response = await fetch('/api/health', { 
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      
      this.log(`API Response: ${response.status} ${response.statusText}`, 
        response.ok ? 'success' : 'error');

      if (response.ok) {
        const data = await response.json();
        this.log(`API Data: ${JSON.stringify(data)}`, 'success');
      }

      // Test 2: Check CORS
      this.log('Test 2: Checking CORS headers...', 'info');
      this.log(`Access-Control-Allow-Origin: ${response.headers.get('access-control-allow-origin') || 'NOT SET'}`, 
        response.headers.get('access-control-allow-origin') ? 'success' : 'warn');

    } catch (error) {
      this.log(`API Test Failed: ${error.message}`, 'error');
      this.log(`Error stack: ${error.stack}`, 'error');
    }
  }

  async checkEnvironment() {
    const envContainer = document.getElementById('diag-env');
    const envContent = document.getElementById('diag-env-content');
    
    envContainer.style.display = envContainer.style.display === 'none' ? 'block' : 'none';
    
    if (envContainer.style.display === 'block') {
      const checks = [];
      
      // Check if running on localhost
      checks.push({
        name: 'Location',
        value: window.location.origin,
        status: 'info'
      });

      // Check if FormData is supported
      checks.push({
        name: 'FormData Support',
        value: typeof FormData !== 'undefined' ? 'Yes' : 'No',
        status: typeof FormData !== 'undefined' ? 'good' : 'bad'
      });

      // Check if fetch is supported
      checks.push({
        name: 'Fetch API',
        value: typeof fetch !== 'undefined' ? 'Yes' : 'No',
        status: typeof fetch !== 'undefined' ? 'good' : 'bad'
      });

      // Check localStorage
      checks.push({
        name: 'LocalStorage',
        value: typeof localStorage !== 'undefined' ? 'Available' : 'Not Available',
        status: typeof localStorage !== 'undefined' ? 'good' : 'warn'
      });

      // Check file API
      checks.push({
        name: 'File API',
        value: typeof File !== 'undefined' ? 'Yes' : 'No',
        status: typeof File !== 'undefined' ? 'good' : 'bad'
      });

      // Try to detect if running on Vercel
      checks.push({
        name: 'Platform',
        value: window.location.hostname.includes('vercel.app') ? 'Vercel' : 'Unknown',
        status: 'info'
      });

      const html = checks.map(check => {
        const colors = {
          good: '#00ff00',
          bad: '#ff0000',
          warn: '#ffff00',
          info: '#00ccff'
        };
        return `<div style="margin: 3px 0;">
          <span style="color: ${colors[check.status]};">●</span>
          <strong>${check.name}:</strong> ${check.value}
        </div>`;
      }).join('');

      envContent.innerHTML = html;
      
      this.log('Environment check completed', 'system');
    }
  }

  show() {
    this.isVisible = true;
    if (this.panel) {
      this.panel.style.display = 'flex';
    }
    document.getElementById('diag-status').textContent = '●';
    document.getElementById('diag-status').style.color = '#00ff00';
  }

  hide() {
    this.isVisible = false;
    if (this.panel) {
      this.panel.style.display = 'none';
    }
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
}

// Auto-initialize
if (typeof window !== 'undefined') {
  window.diagnosticPanel = new DiagnosticPanel();
  
  // Add global helper functions
  window.showDiagnostics = () => window.diagnosticPanel.show();
  window.hideDiagnostics = () => window.diagnosticPanel.hide();
  window.clearDiagnostics = () => window.diagnosticPanel.clearLogs();
  
  console.log('%c🔧 Diagnostic Panel Loaded', 'color: #00ff00; font-weight: bold; font-size: 14px;');
  console.log('%cPress Ctrl+Shift+D to toggle panel', 'color: #00ccff;');
  console.log('%cOr use: showDiagnostics(), hideDiagnostics(), clearDiagnostics()', 'color: #888;');
}
