/**
 * FAIR REPAIR AUTO - BACKEND SERVER
 * Version: 2.2 - FIXED DATA FORMAT
 * Last Updated: January 6, 2026
 * 
 * Features:
 * - Handles nested JSON structure {parts: {low, high}, labor: {low, high}}
 * - Applies regional multiplier to existing labor rates
 * - Available repairs endpoint (prevents "no data" scenarios)
 * - Payment verification hooks (Stripe integration ready)
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLaborRate, getLaborMultiplier, NATIONAL_AVERAGE } from './laborRates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory cache for JSON files
const priceCache = {};

/**
 * HELPER FUNCTIONS - MUST BE DEFINED BEFORE USE
 */

/**
 * Normalize strings for matching
 */
function norm(str) {
  return String(str || '').toLowerCase().trim();
}

/**
 * Normalize year (keep as string, just trim)
 */
function normYear(year) {
  return String(year || '').trim();
}

/**
 * Load and cache a make's pricing data
 * Handles both flat JSON arrays and {data: {...}} wrapped formats
 */
function loadMake(make) {
  const normalized = make.toLowerCase();
  
  if (priceCache[normalized]) {
    return priceCache[normalized];
  }
  
  const jsonPath = path.join(__dirname, 'data', `${normalized}.json`);
  
  if (!fs.existsSync(jsonPath)) {
    return null;
  }
  
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw);
    
    // Handle both formats: direct object or {data: {...}}
    const data = parsed.data || parsed;
    
    priceCache[normalized] = data;
    return data;
  } catch (error) {
    console.error(`Error loading ${normalized}.json:`, error.message);
    return null;
  }
}

/**
 * ENDPOINT: Health Check
 */
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'fair-repair-auto-api',
    version: '2.2',
    mode: 'json-only',
    endpoints: {
      quote: 'POST /api/quote',
      availableRepairs: 'GET /api/available-repairs/:year/:make/:model',
      health: 'GET /'
    }
  });
});

/**
 * ENDPOINT: Get Available Repairs for a Vehicle
 * Prevents "no data" scenarios by only showing repairs that exist
 * 
 * GET /api/available-repairs/:year/:make/:model
 * 
 * Returns: { ok: true, repairs: ["oil-change", "brake-pads", ...] }
 */
app.get('/api/available-repairs/:year/:make/:model', (req, res) => {
  const year = normYear(req.params.year);
  const make = norm(req.params.make);
  const model = norm(req.params.model);
  
  const makeData = loadMake(make);
  
  if (!makeData) {
    return res.json({
      ok: true,
      repairs: [],
      reason: 'MAKE_NOT_FOUND',
      message: `No data available for make: ${make}`
    });
  }
  
  if (!makeData[model]) {
    return res.json({
      ok: true,
      repairs: [],
      reason: 'MODEL_NOT_FOUND',
      message: `No data available for model: ${model}`
    });
  }
  
  if (!makeData[model][year]) {
    return res.json({
      ok: true,
      repairs: [],
      reason: 'YEAR_NOT_FOUND',
      message: `No data available for year: ${year}`
    });
  }
  
  // Return array of available repair slugs
  const repairs = Object.keys(makeData[model][year]);
  
  res.json({
    ok: true,
    count: repairs.length,
    repairs: repairs,
    vehicle: {
      year: year,
      make: make,
      model: model
    }
  });
});

/**
 * ENDPOINT: Get Pricing Quote
 * 
 * POST /api/quote
 * Body: { year, make, model, repairSlug, zip }
 * 
 * Returns: Full pricing with regional labor rate adjustments
 */
app.post('/api/quote', (req, res) => {
  const { year, make, model, repairSlug, zip } = req.body;
  
  // Validate inputs
  if (!year || !make || !model || !repairSlug) {
    return res.status(400).json({
      ok: false,
      error: 'Missing required fields: year, make, model, repairSlug'
    });
  }
  
  // Normalize inputs
  const normMake = norm(make);
  const normModel = norm(model);
  const normYearValue = normYear(year);
  const normRepair = norm(repairSlug);
  
  // Load make data
  const makeData = loadMake(normMake);
  if (!makeData) {
    return res.json({
      ok: true,
      available: false,
      reason: 'MAKE_NOT_FOUND',
      message: `No pricing data available for make: ${make}`
    });
  }
  
  // Check model
  if (!makeData[normModel]) {
    return res.json({
      ok: true,
      available: false,
      reason: 'MODEL_NOT_FOUND',
      message: `No pricing data available for model: ${model}`
    });
  }
  
  // Check year
  if (!makeData[normModel][normYearValue]) {
    return res.json({
      ok: true,
      available: false,
      reason: 'YEAR_NOT_FOUND',
      message: `No pricing data available for year: ${year}`
    });
  }
  
  // Check repair
  if (!makeData[normModel][normYearValue][normRepair]) {
    return res.json({
      ok: true,
      available: false,
      reason: 'REPAIR_NOT_FOUND',
      message: `No pricing data available for repair: ${repairSlug}`
    });
  }
  
  // Get base pricing data
  const repairData = makeData[normModel][normYearValue][normRepair];
  
  // Get labor rate information for ZIP code
  const laborInfo = zip ? getLaborRate(zip) : {
    rate: NATIONAL_AVERAGE,
    source: 'National Average',
    breakdown: { baseRate: NATIONAL_AVERAGE, cityPremium: 0 }
  };
  
  const laborMultiplier = zip ? getLaborMultiplier(zip) : 1.0;
  
  // Extract pricing from nested object structure
  // Format: { parts: {low, high}, labor: {low, high}, total: {low, high} }
  let partsLow, partsHigh, laborLow, laborHigh;
  
  if (repairData.parts && repairData.labor) {
    // Nested object format (current format)
    partsLow = repairData.parts.low;
    partsHigh = repairData.parts.high;
    laborLow = repairData.labor.low;
    laborHigh = repairData.labor.high;
  } else if (Array.isArray(repairData)) {
    // Array format: [partsLow, partsHigh, laborLow, laborHigh]
    [partsLow, partsHigh, laborLow, laborHigh] = repairData;
  } else if (repairData.partsLow !== undefined) {
    // Flat object format: {partsLow, partsHigh, laborLow, laborHigh}
    partsLow = repairData.partsLow;
    partsHigh = repairData.partsHigh;
    laborLow = repairData.laborLow;
    laborHigh = repairData.laborHigh;
  } else {
    return res.json({
      ok: true,
      available: false,
      reason: 'INVALID_FORMAT',
      message: 'Pricing data format not recognized'
    });
  }
  
  // Apply regional multiplier to the labor rates from JSON
  const adjustedLaborLow = Math.round(laborLow * laborMultiplier);
  const adjustedLaborHigh = Math.round(laborHigh * laborMultiplier);
  
  // Calculate total pricing
  const adjustedLow = partsLow + adjustedLaborLow;
  const adjustedHigh = partsHigh + adjustedLaborHigh;
  
  return res.json({
    ok: true,
    available: true,
    price: {
      low: adjustedLow,
      high: adjustedHigh,
      average: Math.round((adjustedLow + adjustedHigh) / 2)
    },
    breakdown: {
      parts: {
        low: partsLow,
        high: partsHigh
      },
      labor: {
        low: adjustedLaborLow,
        high: adjustedLaborHigh,
        baseLow: laborLow,
        baseHigh: laborHigh,
        baseRate: laborInfo.rate,
        source: laborInfo.source
      }
    },
    regionalAdjustment: {
      multiplier: Math.round(laborMultiplier * 1000) / 1000,
      laborRate: laborInfo.rate,
      nationalAverage: NATIONAL_AVERAGE,
      difference: `${laborMultiplier > 1 ? '+' : ''}${Math.round((laborMultiplier - 1) * 100)}%`,
      details: laborInfo.breakdown
    },
    vehicle: {
      year: year,
      make: make,
      model: model,
      repair: repairSlug
    },
    location: {
      zip: zip || 'Not provided',
      source: laborInfo.source
    }
  });
});

/**
 * ENDPOINT: Verify Payment (Stripe Integration Point)
 * 
 * POST /api/verify-payment
 * Body: { paymentIntentId }
 * 
 * Returns: { ok: true, verified: boolean }
 * 
 * TODO: Implement Stripe verification when ready
 */
app.post('/api/verify-payment', async (req, res) => {
  const { paymentIntentId } = req.body;
  
  // PLACEHOLDER: Replace with actual Stripe verification
  // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  // const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  // const verified = paymentIntent.status === 'succeeded';
  
  // For now, return success in development mode
  const verified = process.env.NODE_ENV === 'development' || paymentIntentId === 'test_payment';
  
  res.json({
    ok: true,
    verified: verified,
    message: verified ? 'Payment verified' : 'Payment verification failed'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Fair Repair Auto API running on port ${PORT}`);
  console.log(`📊 Endpoints available:`);
  console.log(`   - GET  /`);
  console.log(`   - GET  /api/available-repairs/:year/:make/:model`);
  console.log(`   - POST /api/quote`);
  console.log(`   - POST /api/verify-payment`);
});

export default app;
