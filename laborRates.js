const BASE_RATE = 140;

const STATE_RATES = {
  NY: 135,
  CA: 150,
  TX: 140,
  FL: 143
};

export function getLaborMultiplier(state) {
  const rate = STATE_RATES[state] || BASE_RATE;
  return rate / BASE_RATE;
}
