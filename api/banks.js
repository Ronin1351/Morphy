/**
 * GET /api/banks
 * Get list of supported bank formats
 * 
 * Returns: Array of supported banks with metadata
 */

import { getSupportedBankFormats } from './utils/transaction-extractor.js';
import fs from 'fs/promises';
import path from 'path';

// Cache for bank formats (refresh every 5 minutes)
let cachedFormats = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Serverless function handler
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle OPTIONS request (CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET method is allowed',
      },
    });
  }

  try {
    // Parse query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const country = url.searchParams.get('country');
    const bankId = url.searchParams.get('id') || url.searchParams.get('bankId');
    const search = url.searchParams.get('search') || url.searchParams.get('q');

    // Get bank formats
    const formats = await getBankFormatsWithCache();

    // Filter by specific bank ID
    if (bankId) {
      const bank = formats.find(f => f.bankId === bankId);
      
      if (!bank) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BANK_NOT_FOUND',
            message: `Bank format not found: ${bankId}`,
          },
        });
      }

      return res.status(200).json({
        success: true,
        bank: formatBankDetails(bank),
      });
    }

    // Filter by country
    let filteredFormats = formats;
    if (country) {
      filteredFormats = filteredFormats.filter(
        f => f.country?.toLowerCase() === country.toLowerCase()
      );
    }

    // Search by name
    if (search) {
      const searchLower = search.toLowerCase();
      filteredFormats = filteredFormats.filter(
        f => f.bankName?.toLowerCase().includes(searchLower) ||
             f.bankId?.toLowerCase().includes(searchLower)
      );
    }

    // Build response
    const response = {
      success: true,
      totalBanks: filteredFormats.length,
      banks: filteredFormats.map(formatBankSummary),
      countries: getUniqueCountries(formats),
      filters: {
        country: country || null,
        search: search || null,
      },
    };

    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes

    return res.status(200).json(response);

  } catch (error) {
    console.error('Banks endpoint error:', error);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'FAILED_TO_LOAD_BANKS',
        message: 'Failed to load supported bank formats',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
    });
  }
}

/**
 * Get bank formats with caching
 */
async function getBankFormatsWithCache() {
  const now = Date.now();
  
  // Return cached data if still valid
  if (cachedFormats && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedFormats;
  }

  // Load fresh data
  try {
    cachedFormats = await getSupportedBankFormats();
    cacheTimestamp = now;
    return cachedFormats;
  } catch (error) {
    console.error('Failed to load bank formats:', error);
    
    // Return default formats if loading fails
    return getDefaultBankFormats();
  }
}

/**
 * Format bank summary for API response
 */
function formatBankSummary(bank) {
  return {
    bankId: bank.bankId,
    bankName: bank.bankName,
    country: bank.country || 'Universal',
    supported: bank.supported !== false,
    icon: bank.icon || null,
    dateFormat: bank.dateFormat || 'MM/DD/YYYY',
    popular: bank.popular || false,
  };
}

/**
 * Format detailed bank information
 */
function formatBankDetails(bank) {
  return {
    bankId: bank.bankId,
    bankName: bank.bankName,
    country: bank.country || 'Universal',
    supported: bank.supported !== false,
    icon: bank.icon || null,
    dateFormat: bank.dateFormat || 'MM/DD/YYYY',
    decimalSeparator: bank.decimalSeparator || '.',
    thousandsSeparator: bank.thousandsSeparator || ',',
    amountPosition: bank.amountPosition || 'separate',
    balanceIncluded: bank.balanceIncluded !== false,
    description: bank.description || null,
    exampleFormats: bank.exampleFormats || [],
    notes: bank.notes || null,
  };
}

/**
 * Get unique countries from bank formats
 */
function getUniqueCountries(formats) {
  const countries = new Set();
  
  formats.forEach(f => {
    if (f.country && f.country !== 'Universal') {
      countries.add(f.country);
    }
  });

  return Array.from(countries).sort();
}

/**
 * Get default bank formats (fallback)
 */
function getDefaultBankFormats() {
  return [
    {
      bankId: 'generic',
      bankName: 'Generic Format',
      country: 'Universal',
      supported: true,
      dateFormat: 'MM/DD/YYYY',
      popular: true,
    },
    {
      bankId: 'us_bank',
      bankName: 'US Bank Format',
      country: 'US',
      supported: true,
      dateFormat: 'MM/DD/YYYY',
      popular: true,
    },
    {
      bankId: 'ph_bank',
      bankName: 'Philippine Bank Format',
      country: 'PH',
      supported: true,
      dateFormat: 'MM/DD/YYYY',
      popular: false,
    },
  ];
}

/**
 * Get bank by ID (helper function)
 */
export async function getBankById(bankId) {
  const formats = await getBankFormatsWithCache();
  return formats.find(f => f.bankId === bankId);
}

/**
 * Check if bank is supported (helper function)
 */
export async function isBankSupported(bankId) {
  const bank = await getBankById(bankId);
  return bank && bank.supported !== false;
}

/**
 * Get popular banks (helper function)
 */
export async function getPopularBanks(limit = 5) {
  const formats = await getBankFormatsWithCache();
  return formats
    .filter(f => f.popular === true)
    .slice(0, limit)
    .map(formatBankSummary);
}

/**
 * Get banks by country (helper function)
 */
export async function getBanksByCountry(countryCode) {
  const formats = await getBankFormatsWithCache();
  return formats
    .filter(f => f.country?.toLowerCase() === countryCode.toLowerCase())
    .map(formatBankSummary);
}

/**
 * Search banks (helper function)
 */
export async function searchBanks(query) {
  const formats = await getBankFormatsWithCache();
  const searchLower = query.toLowerCase();
  
  return formats
    .filter(f => 
      f.bankName?.toLowerCase().includes(searchLower) ||
      f.bankId?.toLowerCase().includes(searchLower) ||
      f.country?.toLowerCase().includes(searchLower)
    )
    .map(formatBankSummary);
}