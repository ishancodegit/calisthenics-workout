export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * Wilder's RSI. Needs period + 1 closes; the first average is a simple mean
 * and everything after it is Wilder-smoothed.
 */
export function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) {
    throw new Error(`RSI needs at least ${period + 1} closes, got ${closes.length}`);
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  // No downside over the whole window: momentum is maxed, RS is undefined.
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;

  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * EMA series seeded with the SMA of the first `period` values, which is the
 * convention MACD assumes.
 */
function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) {
    throw new Error(`EMA needs at least ${period} values, got ${values.length}`);
  }

  const multiplier = 2 / (period + 1);
  const out: number[] = [];

  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    out.push(ema);
  }

  return out;
}

export function calculateMACD(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdResult {
  const required = slowPeriod + signalPeriod;
  if (closes.length < required) {
    throw new Error(`MACD needs at least ${required} closes, got ${closes.length}`);
  }

  const fastEma = emaSeries(closes, fastPeriod);
  const slowEma = emaSeries(closes, slowPeriod);

  // The fast series starts earlier, so drop its head to align the two.
  const offset = fastEma.length - slowEma.length;
  const macdLine = slowEma.map((slow, i) => fastEma[i + offset] - slow);

  const signalLine = emaSeries(macdLine, signalPeriod);

  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];

  return { macd, signal, histogram: macd - signal };
}

/** Minimum bars needed before indicators can be computed at all. */
export const MIN_BARS_REQUIRED = 35;
