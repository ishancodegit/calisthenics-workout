import { TradingConfig } from './types';

const LIVE_TRADING_CONFIRMATION = 'I_UNDERSTAND_THE_RISK';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

/**
 * Going live takes two independent signals: PAPER_TRADING=false and an explicit
 * confirmation string. One stray secret edit should not be able to point the
 * agent at real money.
 */
export function loadConfig(): TradingConfig {
  const apiKey = process.env.ALPACA_API_KEY ?? '';
  const apiSecret = process.env.ALPACA_API_SECRET ?? '';

  if (!apiKey || !apiSecret) {
    throw new Error('ALPACA_API_KEY and ALPACA_API_SECRET must be set');
  }

  const paperTrading = process.env.PAPER_TRADING !== 'false';

  if (!paperTrading && process.env.CONFIRM_LIVE_TRADING !== LIVE_TRADING_CONFIRMATION) {
    throw new Error(
      `Refusing to trade live. PAPER_TRADING is false but CONFIRM_LIVE_TRADING is not set to ` +
        `"${LIVE_TRADING_CONFIRMATION}". Set both, or set PAPER_TRADING=true.`
    );
  }

  const symbols = (process.env.SYMBOLS ?? 'AAPL,MSFT,GOOGL')
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    throw new Error('SYMBOLS must list at least one ticker');
  }

  return {
    apiKey,
    apiSecret,
    paperTrading,
    maxDailyLossPercent: num('MAX_DAILY_LOSS_PERCENT', 2),
    maxPositionSizePercent: num('MAX_POSITION_SIZE_PERCENT', 5),
    maxOpenPositions: num('MAX_OPEN_POSITIONS', 5),
    minStopLossPercent: num('MIN_STOP_LOSS_PERCENT', 2),
    maxLeverage: num('MAX_LEVERAGE', 1),
    minConfidence: num('MIN_CONFIDENCE', 0.5),
    symbols,
  };
}
