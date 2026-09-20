import { calculateRSI, calculateMACD } from '../indicators';

let failures = 0;
function check(name: string, actual: number, expected: number, tolerance: number) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${actual.toFixed(4)}, expected ~${expected} (±${tolerance})`);
}

// Wilder's canonical RSI example (StockCharts reference series).
const wilder = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
  45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
];
check('RSI Wilder reference', calculateRSI(wilder, 14), 70.46, 0.6);

// Monotonic rise -> RSI pinned at 100.
const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
check('RSI all-gains', calculateRSI(rising, 14), 100, 0.001);

// Monotonic fall -> RSI pinned at 0.
const falling = Array.from({ length: 30 }, (_, i) => 130 - i);
check('RSI all-losses', calculateRSI(falling, 14), 0, 0.001);

// Flat series -> no gains, no losses -> neutral.
const flat = Array.from({ length: 30 }, () => 100);
check('RSI flat', calculateRSI(flat, 14), 50, 0.001);

// MACD on a steadily rising series: fast EMA leads slow, so MACD > 0.
const trendUp = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5);
const up = calculateMACD(trendUp);
console.log(`      MACD uptrend: macd=${up.macd.toFixed(4)} signal=${up.signal.toFixed(4)} hist=${up.histogram.toFixed(4)}`);
check('MACD uptrend is positive', up.macd > 0 ? 1 : 0, 1, 0);

// MACD on a falling series must invert.
const trendDown = Array.from({ length: 60 }, (_, i) => 130 - i * 0.5);
const down = calculateMACD(trendDown);
console.log(`      MACD downtrend: macd=${down.macd.toFixed(4)} signal=${down.signal.toFixed(4)} hist=${down.histogram.toFixed(4)}`);
check('MACD downtrend is negative', down.macd < 0 ? 1 : 0, 1, 0);

// Flat series -> MACD collapses to zero.
const flatLong = Array.from({ length: 60 }, () => 100);
const flatMacd = calculateMACD(flatLong);
check('MACD flat', flatMacd.macd, 0, 0.0001);

// Insufficient data must throw rather than silently return garbage.
try {
  calculateRSI([1, 2, 3], 14);
  console.log('FAIL  RSI short input should throw');
  failures++;
} catch {
  console.log('PASS  RSI short input throws');
}

try {
  calculateMACD(Array.from({ length: 10 }, (_, i) => i));
  console.log('FAIL  MACD short input should throw');
  failures++;
} catch {
  console.log('PASS  MACD short input throws');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
