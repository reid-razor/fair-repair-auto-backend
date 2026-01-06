/**
 * LABOR RATES MODULE
 * 2025 National Labor Rates for Auto Mechanics
 * Source: Identifix 2025 + NATA 2024 Survey + Industry Reports
 */

const { getStateFromZip } = require('./zipToState');

// 2025 Labor Rates by State (dollars per hour)
const STATE_LABOR_RATES = {
  // States with specific 2025 rates
  'AZ': 138.78,
  'DE': 142.15,
  'FL': 142.74,
  'HI': 136.74,
  'MS': 151.67,
  'NE': 147.41,
  'OH': 136.07,
  'OK': 147.81,
  'OR': 151.00,
  'VT': 127.15,
  'WY': 151.18,
  
  // Regional averages for other states (2025 Identifix data)
  // Midwest: $144.17/hr
  'IL': 144.17, 'IN': 144.17, 'IA': 144.17, 'KS': 144.17, 'MI': 144.17,
  'MN': 144.17, 'MO': 144.17, 'ND': 144.17, 'SD': 144.17, 'WI': 144.17,
  
  // Northeast: $135.63/hr
  'CT': 135.63, 'ME': 135.63, 'MA': 135.63, 'NH': 135.63, 'NJ': 135.63,
  'NY': 135.63, 'PA': 135.63, 'RI': 135.63,
  
  // Southeast: $146.47/hr
  'AL': 146.47, 'AR': 146.47, 'GA': 146.47, 'KY': 146.47, 'LA': 146.47,
  'NC': 146.47, 'SC': 146.47, 'TN': 146.47, 'VA': 146.47, 'WV': 146.47,
  
  // Southwest: $144.57/hr
  'NM': 144.57, 'TX': 144.57,
  
  // West: $144.06/hr
  'AK': 144.06, 'CA': 144.06, 'CO': 144.06, 'ID': 144.06, 'MT': 144.06,
  'NV': 144.06, 'UT': 144.06, 'WA': 144.06,
  
  // Special cases
  'MD': 135.63, // Near DC, use Northeast
  'DC': 135.63  // Federal district
};

// National average (used as baseline)
const NATIONAL_AVERAGE = 144.06;

// Major US Cities Coordinates (for distance-based premium calculation)
const CITY_COORDINATES = {
  'new york': { lat: 40.7128, lon: -74.0060, rate: 140 },
  'los angeles': { lat: 34.0522, lon: -118.2437, rate: 149.50 },
  'chicago': { lat: 41.8781, lon: -87.6298, rate: 147 },
  'houston': { lat: 29.7604, lon: -95.3698, rate: 147 },
  'phoenix': { lat: 33.4484, lon: -112.0740, rate: 142 },
  'philadelphia': { lat: 39.9526, lon: -75.1652, rate: 140 },
  'san antonio': { lat: 29.4241, lon: -98.4936, rate: 147 },
  'san diego': { lat: 32.7157, lon: -117.1611, rate: 149.50 },
  'dallas': { lat: 32.7767, lon: -96.7970, rate: 147 },
  'san jose': { lat: 37.3382, lon: -121.8863, rate: 150 },
  'austin': { lat: 30.2672, lon: -97.7431, rate: 147 },
  'jacksonville': { lat: 30.3322, lon: -81.6557, rate: 144.50 },
  'fort worth': { lat: 32.7555, lon: -97.3308, rate: 147 },
  'charlotte': { lat: 35.2271, lon: -80.8431, rate: 148 },
  'san francisco': { lat: 37.7749, lon: -122.4194, rate: 152.50 },
  'indianapolis': { lat: 39.7684, lon: -86.1581, rate: 147 },
  'columbus': { lat: 39.9612, lon: -82.9988, rate: 140 },
  'seattle': { lat: 47.6062, lon: -122.3321, rate: 147 },
  'denver': { lat: 39.7392, lon: -104.9903, rate: 147 },
  'washington dc': { lat: 38.9072, lon: -77.0369, rate: 140 },
  'boston': { lat: 42.3601, lon: -71.0589, rate: 140 },
  'nashville': { lat: 36.1627, lon: -86.7816, rate: 148 },
  'oklahoma city': { lat: 35.4676, lon: -97.5164, rate: 148 },
  'las vegas': { lat: 36.1699, lon: -115.1398, rate: 147 },
  'portland': { lat: 45.5152, lon: -122.6784, rate: 151 }
};

/**
 * Calculate distance between two coordinates (Haversine formula)
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in miles
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

/**
 * Estimate coordinates for a ZIP code
 * @param {string} zip - 5-digit ZIP code
 * @returns {object} {lat, lon} coordinates
 */
function getZipCoordinates(zip) {
  const zipNum = parseInt(zip);
  let lat, lon;
  
  // Rough approximation based on ZIP code ranges
  if (zipNum >= 10000 && zipNum <= 14999) { // NY area
    lat = 40.7 + (zipNum - 10000) / 50000;
    lon = -74.0 + (zipNum - 10000) / 100000;
  } else if (zipNum >= 90000 && zipNum <= 96999) { // CA area
    lat = 34.0 + (zipNum - 90000) / 70000;
    lon = -118.0 + (zipNum - 90000) / 100000;
  } else if (zipNum >= 60000 && zipNum <= 69999) { // IL area
    lat = 41.8 + (zipNum - 60000) / 100000;
    lon = -87.6 + (zipNum - 60000) / 100000;
  } else if (zipNum >= 77000 && zipNum <= 79999) { // TX area
    lat = 29.7 + (zipNum - 77000) / 30000;
    lon = -95.3 + (zipNum - 77000) / 50000;
  } else {
    // Default to center of US
    lat = 39.8;
    lon = -98.5;
  }
  
  return { lat, lon };
}

/**
 * Get labor rate for a ZIP code
 * Factors in: state base rate + city premium (if within 15 miles of major city)
 * @param {string} zip - 5-digit ZIP code
 * @returns {object} { rate: number, source: string, breakdown: object }
 */
function getLaborRate(zip) {
  if (!zip || zip.length !== 5) {
    return {
      rate: NATIONAL_AVERAGE,
      source: 'National Average',
      breakdown: {
        baseRate: NATIONAL_AVERAGE,
        cityPremium: 0,
        nearestCity: null
      }
    };
  }

  // Get state from ZIP
  const state = getStateFromZip(zip);
  if (!state) {
    return {
      rate: NATIONAL_AVERAGE,
      source: 'National Average',
      breakdown: {
        baseRate: NATIONAL_AVERAGE,
        cityPremium: 0,
        nearestCity: null
      }
    };
  }

  // Get base state rate
  const baseRate = STATE_LABOR_RATES[state] || NATIONAL_AVERAGE;
  
  // Check if near a major city (within 15 miles)
  const zipCoords = getZipCoordinates(zip);
  let nearestCity = null;
  let minDistance = Infinity;
  
  for (const [cityName, cityData] of Object.entries(CITY_COORDINATES)) {
    const distance = calculateDistance(
      zipCoords.lat, zipCoords.lon,
      cityData.lat, cityData.lon
    );
    
    if (distance < minDistance) {
      minDistance = distance;
      nearestCity = { name: cityName, distance, rate: cityData.rate };
    }
  }
  
  // If within 15 miles of major city, use city rate instead
  if (nearestCity && minDistance <= 15) {
    return {
      rate: nearestCity.rate,
      source: `${nearestCity.name} metro area`,
      breakdown: {
        baseRate: baseRate,
        cityPremium: nearestCity.rate - baseRate,
        nearestCity: nearestCity.name,
        distanceToCity: Math.round(minDistance * 10) / 10
      }
    };
  }
  
  // Otherwise use state rate
  return {
    rate: baseRate,
    source: `${state} state average`,
    breakdown: {
      baseRate: baseRate,
      cityPremium: 0,
      nearestCity: nearestCity ? nearestCity.name : null,
      distanceToCity: nearestCity ? Math.round(minDistance * 10) / 10 : null
    }
  };
}

/**
 * Calculate labor rate multiplier relative to national average
 * @param {string} zip - 5-digit ZIP code
 * @returns {number} Multiplier (e.g., 1.05 = 5% higher than national average)
 */
function getLaborMultiplier(zip) {
  const { rate } = getLaborRate(zip);
  return rate / NATIONAL_AVERAGE;
}

module.exports = {
  STATE_LABOR_RATES,
  NATIONAL_AVERAGE,
  CITY_COORDINATES,
  getLaborRate,
  getLaborMultiplier,
  getZipCoordinates,
  calculateDistance
};
