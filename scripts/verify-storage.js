/**
 * Vercel Blob & KV Storage Verification Script
 *
 * This script tests the connectivity and functionality of:
 * 1. Vercel Blob Storage
 * 2. Vercel KV Storage
 *
 * Usage:
 *   node scripts/verify-storage.js
 *
 * Environment variables required:
 *   - BLOB_READ_WRITE_TOKEN
 *   - KV_REST_API_URL (optional - auto-configured by Vercel)
 *   - KV_REST_API_TOKEN (optional - auto-configured by Vercel)
 */

import { put, del, list } from '@vercel/blob';
import { kv } from '@vercel/kv';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

// Test configuration
const TEST_FILE_CONTENT = Buffer.from('This is a test file for Vercel Blob Storage verification');
const TEST_FILENAME = `test-${randomUUID()}.txt`;
const TEST_KV_KEY = `test_${randomUUID()}`;

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ ${message}`, 'cyan');
}

function logSection(message) {
  console.log();
  log(`${'='.repeat(60)}`, 'blue');
  log(message, 'blue');
  log(`${'='.repeat(60)}`, 'blue');
}

/**
 * Check environment variables
 */
function checkEnvironmentVariables() {
  logSection('Checking Environment Variables');

  const requiredVars = {
    'BLOB_READ_WRITE_TOKEN': process.env.BLOB_READ_WRITE_TOKEN,
    'KV_REST_API_URL': process.env.KV_REST_API_URL,
    'KV_REST_API_TOKEN': process.env.KV_REST_API_TOKEN,
  };

  let allPresent = true;

  for (const [varName, value] of Object.entries(requiredVars)) {
    if (!value || value.includes('your_') || value.includes('xxxxx')) {
      logError(`${varName} is not configured or contains placeholder value`);
      logInfo(`  Current value: ${value || '(empty)'}`);
      allPresent = false;
    } else {
      logSuccess(`${varName} is configured`);
      // Show first and last 4 characters for security
      const masked = value.length > 8
        ? `${value.slice(0, 4)}...${value.slice(-4)}`
        : '****';
      logInfo(`  Value: ${masked}`);
    }
  }

  return allPresent;
}

/**
 * Test Vercel Blob Storage
 */
async function testBlobStorage() {
  logSection('Testing Vercel Blob Storage');

  let uploadedUrl = null;

  try {
    // Test 1: Upload file
    logInfo('Test 1: Uploading test file...');
    const blob = await put(TEST_FILENAME, TEST_FILE_CONTENT, {
      access: 'public',
      contentType: 'text/plain',
      addRandomSuffix: false,
    });

    uploadedUrl = blob.url;
    logSuccess('File uploaded successfully');
    logInfo(`  URL: ${blob.url}`);
    logInfo(`  Size: ${TEST_FILE_CONTENT.length} bytes`);

    // Test 2: Verify file is accessible
    logInfo('Test 2: Verifying file accessibility...');
    const response = await fetch(blob.url);

    if (!response.ok) {
      throw new Error(`Failed to fetch uploaded file: ${response.status} ${response.statusText}`);
    }

    const downloadedContent = await response.text();

    if (downloadedContent !== TEST_FILE_CONTENT.toString()) {
      throw new Error('Downloaded content does not match uploaded content');
    }

    logSuccess('File is accessible and content matches');

    // Test 3: List blobs
    logInfo('Test 3: Listing blobs...');
    const { blobs } = await list({ prefix: 'test-' });

    logSuccess(`Found ${blobs.length} test file(s) in storage`);

    // Test 4: Delete file
    logInfo('Test 4: Deleting test file...');
    await del(blob.url);
    logSuccess('File deleted successfully');
    uploadedUrl = null;

    // Test 5: Verify deletion
    logInfo('Test 5: Verifying file deletion...');
    const verifyResponse = await fetch(blob.url);

    if (verifyResponse.ok) {
      logWarning('File still accessible after deletion (might be cached)');
    } else {
      logSuccess('File successfully removed from storage');
    }

    logSection('Blob Storage Test Results');
    logSuccess('All Blob Storage tests passed');
    return true;

  } catch (error) {
    logError(`Blob Storage test failed: ${error.message}`);

    // Detailed error information
    if (error.message.includes('BLOB_READ_WRITE_TOKEN')) {
      logWarning('Issue: BLOB_READ_WRITE_TOKEN is not configured correctly');
      logInfo('Solution: Set BLOB_READ_WRITE_TOKEN in your .env.local file');
      logInfo('Get token from: https://vercel.com/dashboard → Storage → Blob → Connect');
    } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      logWarning('Issue: Authentication failed');
      logInfo('Solution: Verify your BLOB_READ_WRITE_TOKEN is correct and not expired');
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      logWarning('Issue: Access denied');
      logInfo('Solution: Ensure your token has read-write permissions');
    } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
      logWarning('Issue: Network connectivity problem');
      logInfo('Solution: Check your internet connection and firewall settings');
    }

    logInfo(`Error stack: ${error.stack}`);

    // Cleanup if file was uploaded
    if (uploadedUrl) {
      try {
        logInfo('Attempting cleanup of uploaded file...');
        await del(uploadedUrl);
        logSuccess('Cleanup successful');
      } catch (cleanupError) {
        logWarning(`Cleanup failed: ${cleanupError.message}`);
      }
    }

    return false;
  }
}

/**
 * Test Vercel KV Storage
 */
async function testKVStorage() {
  logSection('Testing Vercel KV Storage');

  try {
    // Test 1: Set key-value pair
    logInfo('Test 1: Setting test key-value pair...');
    const testData = {
      timestamp: Date.now(),
      message: 'This is a test entry',
      uuid: randomUUID(),
    };

    await kv.set(TEST_KV_KEY, testData, { ex: 60 }); // Expire in 60 seconds
    logSuccess('Key-value pair stored successfully');
    logInfo(`  Key: ${TEST_KV_KEY}`);
    logInfo(`  Data: ${JSON.stringify(testData, null, 2)}`);

    // Test 2: Retrieve value
    logInfo('Test 2: Retrieving stored value...');
    const retrievedData = await kv.get(TEST_KV_KEY);

    if (!retrievedData) {
      throw new Error('Failed to retrieve stored data');
    }

    if (JSON.stringify(retrievedData) !== JSON.stringify(testData)) {
      throw new Error('Retrieved data does not match stored data');
    }

    logSuccess('Data retrieved successfully and matches');

    // Test 3: Check expiration
    logInfo('Test 3: Checking TTL (Time To Live)...');
    const ttl = await kv.ttl(TEST_KV_KEY);

    if (ttl > 0 && ttl <= 60) {
      logSuccess(`TTL is set correctly: ${ttl} seconds remaining`);
    } else {
      logWarning(`TTL value unexpected: ${ttl} seconds`);
    }

    // Test 4: Update value
    logInfo('Test 4: Updating value...');
    const updatedData = { ...testData, updated: true };
    await kv.set(TEST_KV_KEY, updatedData, { ex: 60 });

    const newRetrievedData = await kv.get(TEST_KV_KEY);

    if (newRetrievedData.updated !== true) {
      throw new Error('Failed to update value');
    }

    logSuccess('Value updated successfully');

    // Test 5: Delete key
    logInfo('Test 5: Deleting test key...');
    await kv.del(TEST_KV_KEY);
    logSuccess('Key deleted successfully');

    // Test 6: Verify deletion
    logInfo('Test 6: Verifying key deletion...');
    const deletedData = await kv.get(TEST_KV_KEY);

    if (deletedData !== null) {
      throw new Error('Key still exists after deletion');
    }

    logSuccess('Key successfully removed from storage');

    logSection('KV Storage Test Results');
    logSuccess('All KV Storage tests passed');
    return true;

  } catch (error) {
    logError(`KV Storage test failed: ${error.message}`);

    // Detailed error information
    if (error.message.includes('KV_REST_API') || error.message.includes('KV_URL')) {
      logWarning('Issue: KV environment variables not configured correctly');
      logInfo('Solution: Set KV_REST_API_URL and KV_REST_API_TOKEN in .env.local');
      logInfo('Get credentials from: https://vercel.com/dashboard → Storage → KV → Connect');
    } else if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      logWarning('Issue: Authentication failed');
      logInfo('Solution: Verify your KV_REST_API_TOKEN is correct and not expired');
    } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
      logWarning('Issue: Access denied');
      logInfo('Solution: Ensure your KV token has the correct permissions');
    } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
      logWarning('Issue: Network connectivity problem');
      logInfo('Solution: Check your internet connection and KV_REST_API_URL');
    }

    logInfo(`Error stack: ${error.stack}`);

    // Cleanup if key was created
    try {
      logInfo('Attempting cleanup of test key...');
      await kv.del(TEST_KV_KEY);
      logSuccess('Cleanup successful');
    } catch (cleanupError) {
      logWarning(`Cleanup failed: ${cleanupError.message}`);
    }

    return false;
  }
}

/**
 * Main execution
 */
async function main() {
  console.clear();
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║   Vercel Blob & KV Storage Verification Script            ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝\n', 'cyan');

  // Step 1: Check environment variables
  const envVarsOk = checkEnvironmentVariables();

  if (!envVarsOk) {
    logSection('Verification Failed');
    logError('Environment variables are not configured correctly');
    logInfo('\nPlease update your .env.local file with the correct values:');
    logInfo('1. Go to https://vercel.com/dashboard');
    logInfo('2. Navigate to Storage → Blob and Storage → KV');
    logInfo('3. Copy the connection credentials');
    logInfo('4. Update .env.local with the actual values');
    process.exit(1);
  }

  // Step 2: Test Blob Storage
  const blobTestPassed = await testBlobStorage();

  // Step 3: Test KV Storage
  const kvTestPassed = await testKVStorage();

  // Final summary
  logSection('Final Summary');

  if (blobTestPassed && kvTestPassed) {
    logSuccess('All tests passed! Your storage is configured correctly.');
    log('\n✨ You can now use Blob and KV storage in your application', 'green');
    process.exit(0);
  } else {
    logError('Some tests failed. Please review the errors above.');

    if (!blobTestPassed) {
      logError('- Blob Storage: FAILED');
    }
    if (!kvTestPassed) {
      logError('- KV Storage: FAILED');
    }

    log('\n📖 For help, check the documentation:', 'yellow');
    logInfo('  Blob: https://vercel.com/docs/storage/vercel-blob');
    logInfo('  KV: https://vercel.com/docs/storage/vercel-kv');

    process.exit(1);
  }
}

// Run the verification
main().catch((error) => {
  logError(`Unexpected error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
