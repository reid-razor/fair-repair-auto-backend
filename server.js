/**
 * FAIR REPAIR AUTO - BACKEND SERVER
 * Version: 2.4 - STRIPE PAYMENT INTEGRATION
 * Last Updated: January 24, 2026
 * 
 * NEW IN V2.4:
 * - Stripe Checkout Session creation
 * - Payment success verification
 * - Webhook endpoint for payment events
 * - Session metadata storage (vehicle, repair, pricing)
 * 
 * EXISTING FEATURES:
 * - Handles nested JSON structure {parts: {low, high}, labor: {low, high}}
 * - Applies regional multiplier to existing labor rates
 * - Available repairs endpoint (prevents "no data" scenarios)
 * - Production years endpoint (serves vehicle/year data to frontend)
 * 
 * ENVIRONMENT VARIABLES REQUIRED:
 * - STRIPE_SECRET_KEY: Your Stripe secret key (sk_test_... or sk_live_...)
 * - FRONTEND_URL: Your website URL (e.g., https://fairrepairauto.com)
 * - PORT: Server port (default: 3000, Render sets automatically)
 * 
 * STRIPE INTEGRATION FLOW:
 * 1. Frontend calls /api/quote to verify pricing available
 * 2. Frontend calls /api/create-checkout-session with vehicle/repair data
 * 3. Backend creates Stripe Checkout Session with metadata
 * 4. User redirects to Stripe's hosted checkout page
 * 5. After payment, Stripe redirects to /success?session_id=xxx
 * 6. Success page calls /api/session/:sessionId to retrieve pricing data
 * 7. Pricing report displays to user
 */

import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// STRIPE INITIALIZATION
// ============================================================
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_YOUR_SECRET_KEY_HERE', {
  apiVersion: '2024-12-18.acacia',
});

// ============================================================
// CORS CONFIGURATION
// ============================================================
app.use(cors({
  origin: [
    'https://fair-repair-auto.webflow.io',
    'https://fairrepairauto.com',
    'https://www.fairrepairauto.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-Authkey', 'x-authkey']
}));

app.use(express.json());

// ============================================================
// API KEY VALIDATION MIDDLEWARE
// ============================================================
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-authkey'];
  const validKey = 'fe37dba23fba11f0931f0242ac120002';
  
  if (apiKey !== validKey) {
    return res.status(401).json({ ok: false, error: 'Invalid API key' });
  }
  next();
};

// ============================================================
// DATA STORAGE
// ============================================================
let productionYears = {};
let laborRates = {};
let zipToState = {};
let vehicleData = {};

// ============================================================
// LOAD DATA FILES ON STARTUP
// ============================================================
async function loadData() {
  try {
    console.log('📂 Loading data files...');
    
    // Load supporting data
    productionYears = JSON.parse(await fs.readFile(path.join(__dirname, 'production_years.json'), 'utf-8'));
    laborRates = JSON.parse(await fs.readFile(path.join(__dirname, 'labor_rates_2025.json'), 'utf-8'));
    zipToState = JSON.parse(await fs.readFile(path.join(__dirname, 'zip_to_state.json'), 'utf-8'));
    
    console.log(`  ✅ Production years: ${Object.keys(productionYears).length} makes`);
    console.log(`  ✅ Labor rates: ${Object.keys(laborRates).length} regions`);
    console.log(`  ✅ ZIP mapping: ${Object.keys(zipToState).length} ZIPs`);
    
    // Load all make.json files
    const files = await fs.readdir(__dirname);
    const makeFiles = files.filter(f => 
      f.endsWith('.json') && 
      !['production_years.json', 'labor_rates_2025.json', 'zip_to_state.json'].includes(f)
    );
    
    for (const file of makeFiles) {
      const makeName = file.replace('.json', '');
      vehicleData[makeName] = JSON.parse(await fs.readFile(path.join(__dirname, file), 'utf-8'));
    }
    
    console.log(`  ✅ Vehicle data: ${makeFiles.length} makes loaded`);
    console.log('✅ All data files loaded successfully\n');
    
  } catch (error) {
    console.error('❌ Error loading data:', error);
    process.exit(1); // Exit if data can't load - app won't work without it
  }
}

loadData();

// ============================================================
// HEALTH CHECK ENDPOINT
// ============================================================
app.get('/', (req, res) => {
  const stripeConfigured = process.env.STRIPE_SECRET_KEY && 
                          process.env.STRIPE_SECRET_KEY !== 'sk_test_YOUR_SECRET_KEY_HERE';
  
  res.json({
    ok: true,
    version: '2.4',
    status: 'Fair Repair Auto API - Stripe Payment Integration',
    endpoints: {
      health: '/',
      production_years: '/api/production-years',
      available_repairs: '/api/available-repairs/:year/:make/:model',
      quote: '/api/quote (POST)',
      create_checkout: '/api/create-checkout-session (POST)',
      get_session: '/api/session/:sessionId',
      webhook: '/api/webhook (POST)'
    },
    stripe: stripeConfigured ? 'configured' : 'not configured',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// GET PRODUCTION YEARS (For Frontend Vehicle Dropdowns)
// ============================================================
app.get('/api/production-years', validateApiKey, (req, res) => {
  res.json({
    ok: true,
    data: productionYears,
    count: Object.keys(productionYears).length
  });
});

// ============================================================
// GET AVAILABLE REPAIRS FOR A VEHICLE
// ============================================================
app.get('/api/available-repairs/:year/:make/:model', validateApiKey, (req, res) => {
  const { year, make, model } = req.params;
  
  console.log(`🔍 Available repairs request: ${year} ${make} ${model}`);
  
  const makeData = vehicleData[make.toLowerCase()];
  if (!makeData) {
    console.log(`  ❌ Make not found: ${make}`);
    return res.json({ ok: false, error: 'Make not found', repairs: [], count: 0 });
  }
  
  const modelData = makeData[model.toLowerCase()];
  if (!modelData) {
    console.log(`  ❌ Model not found: ${model}`);
    return res.json({ ok: false, error: 'Model not found', repairs: [], count: 0 });
  }
  
  const yearData = modelData[year];
  if (!yearData) {
    console.log(`  ❌ Year not found: ${year}`);
    return res.json({ ok: false, error: 'Year not found', repairs: [], count: 0 });
  }
  
  const repairSlugs = Object.keys(yearData);
  console.log(`  ✅ Found ${repairSlugs.length} repairs`);
  
  res.json({
    ok: true,
    repairs: repairSlugs,
    count: repairSlugs.length,
    vehicle: { year, make, model }
  });
});

// ============================================================
// GET PRICING QUOTE (Verify Data Available Before Payment)
// ============================================================
app.post('/api/quote', validateApiKey, async (req, res) => {
  const { year, make, model, repairSlug, zip } = req.body;
  
  console.log(`💰 Quote request: ${year} ${make} ${model} - ${repairSlug} (ZIP: ${zip})`);
  
  try {
    // Get vehicle data
    const makeData = vehicleData[make.toLowerCase()];
    if (!makeData) {
      return res.json({ ok: false, error: 'Make not found' });
    }
    
    const modelData = makeData[model.toLowerCase()];
    if (!modelData) {
      return res.json({ ok: false, error: 'Model not found' });
    }
    
    const yearData = modelData[year];
    if (!yearData) {
      return res.json({ ok: false, error: 'Year not found' });
    }
    
    const repairData = yearData[repairSlug];
    if (!repairData) {
      return res.json({ ok: false, error: 'Repair not found' });
    }
    
    // Get regional labor rate
    const state = zipToState[zip] || 'national';
    const laborRate = laborRates[state] || laborRates['national'] || 140;
    
    // Calculate pricing
    const partsLow = repairData.PartsLow || 0;
    const partsHigh = repairData.PartsHigh || 0;
    const laborLow = repairData.LaborLow || 0;
    const laborHigh = repairData.LaborHigh || 0;
    const totalLow = partsLow + laborLow;
    const totalHigh = partsHigh + laborHigh;
    
    console.log(`  ✅ Quote calculated: $${totalLow}-$${totalHigh}`);
    
    res.json({
      ok: true,
      available: true,
      price: {
        low: totalLow,
        high: totalHigh
      },
      breakdown: {
        parts: { low: partsLow, high: partsHigh },
        labor: { low: laborLow, high: laborHigh, baseRate: laborRate }
      },
      location: {
        zip: zip,
        state: state,
        source: 'Identifix 2025 Regional Data'
      },
      repairTitle: repairData.RepairTitle || repairSlug,
      vehicle: { year, make, model }
    });
    
  } catch (error) {
    console.error('❌ Quote error:', error);
    res.json({ ok: false, error: error.message });
  }
});

// ============================================================
// CREATE STRIPE CHECKOUT SESSION
// ============================================================
app.post('/api/create-checkout-session', validateApiKey, async (req, res) => {
  const { vehicle, repair, zip, quoteData } = req.body;
  
  console.log(`💳 Creating Stripe session for: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  
  try {
    // Validate required data
    if (!vehicle || !repair || !zip || !quoteData) {
      throw new Error('Missing required fields');
    }
    
    // Format vehicle description for Stripe
    const vehicleDesc = `${vehicle.year} ${vehicle.make.toUpperCase()} ${vehicle.model.toUpperCase()}`;
    
    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Fair Repair Auto - Pricing Report',
              description: `${vehicleDesc} - ${repair}`,
            },
            unit_amount: 499, // $4.99 in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'https://fairrepairauto.com'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'https://fairrepairauto.com'}/`,
      metadata: {
        // Store all pricing data in metadata so success page can retrieve it
        year: vehicle.year.toString(),
        make: vehicle.make,
        model: vehicle.model,
        repair: repair,
        zip: zip,
        priceLow: quoteData.price.low.toString(),
        priceHigh: quoteData.price.high.toString(),
        partsLow: quoteData.breakdown.parts.low.toString(),
        partsHigh: quoteData.breakdown.parts.high.toString(),
        laborLow: quoteData.breakdown.labor.low.toString(),
        laborHigh: quoteData.breakdown.labor.high.toString(),
        laborRate: quoteData.breakdown.labor.baseRate.toString(),
        state: quoteData.location.state
      },
      customer_email: req.body.email || undefined,
    });
    
    console.log(`  ✅ Session created: ${session.id}`);
    
    res.json({
      ok: true,
      sessionId: session.id,
      url: session.url
    });
    
  } catch (error) {
    console.error('❌ Stripe session creation error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ============================================================
// GET SESSION DETAILS (For Success Page)
// ============================================================
app.get('/api/session/:sessionId', validateApiKey, async (req, res) => {
  console.log(`📋 Retrieving session: ${req.params.sessionId}`);
  
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    
    console.log(`  ✅ Session retrieved: ${session.payment_status}`);
    
    res.json({
      ok: true,
      payment_status: session.payment_status,
      customer_email: session.customer_details?.email,
      metadata: session.metadata
    });
    
  } catch (error) {
    console.error('❌ Session retrieval error:', error);
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ============================================================
// WEBHOOK ENDPOINT (Optional - For Production)
// ============================================================
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.log('⚠️  Webhook secret not configured - skipping verification');
    return res.status(400).send('Webhook secret not configured');
  }
  
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    
    console.log(`🔔 Webhook received: ${event.type}`);
    
    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        const session = event.data.object;
        console.log(`  💰 Payment successful: ${session.id}`);
        // TODO: Send email with pricing report
        // TODO: Log purchase to database
        break;
      
      case 'payment_intent.succeeded':
        console.log('  ✅ Payment intent succeeded');
        break;
      
      case 'payment_intent.payment_failed':
        console.log('  ❌ Payment failed');
        break;
      
      default:
        console.log(`  ℹ️  Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// ============================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({
    ok: false,
    error: 'Internal server error',
    message: err.message
  });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 FAIR REPAIR AUTO API v2.4');
  console.log('='.repeat(60));
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'Not set'}`);
  console.log('='.repeat(60) + '\n');
});
