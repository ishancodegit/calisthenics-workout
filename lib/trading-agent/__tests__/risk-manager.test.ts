import { RiskManager } from '../risk-manager';
import type { TradingConfig, PortfolioState, TradeSignal } from '../types';

const config: TradingConfig = {
  apiKey: 'x', apiSecret: 'x', paperTrading: true,
  maxDailyLossPercent: 2,
  maxPositionSizePercent: 5,
  maxOpenPositions: 3,
  minStopLossPercent: 2,
  maxLeverage: 1,
  minConfidence: 0.5,
  symbols: ['AAPL', 'MSFT'],
};

const rm = new RiskManager(config);

const basePortfolio: PortfolioState = {
  equity: 100_000,
  cash: 100_000,
  buyingPower: 100_000,
  positions: [],
  dailyPnL: 0,
  unrealizedPnL: 0,
};

const buy = (symbol = 'AAPL', confidence = 0.8): TradeSignal => ({
  symbol, action: 'buy', confidence, reason: 'test', riskLevel: 'low',
});

let failures = 0;
function expect(name: string, decision: { allowed: boolean; reason?: string }, shouldAllow: boolean) {
  const ok = decision.allowed === shouldAllow;
  if (!ok) failures++;
  const verdict = decision.allowed ? 'ALLOWED' : `BLOCKED (${decision.reason})`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n        -> ${verdict}`);
}

// Baseline: a normal trade within every limit.
expect('normal trade is allowed', rm.validateTrade(buy(), 20, 150, basePortfolio), true);

// Daily loss limit: -2% of 100k = -2000.
expect('blocks at daily loss limit',
  rm.validateTrade(buy(), 20, 150, { ...basePortfolio, dailyPnL: -2000 }), false);
expect('allows just inside daily loss limit',
  rm.validateTrade(buy(), 20, 150, { ...basePortfolio, dailyPnL: -1999 }), true);

// Position size: 5% of 100k = 5000 max. 40 * 150 = 6000 -> too big.
expect('blocks oversized position',
  rm.validateTrade(buy(), 40, 150, basePortfolio), false);
expect('allows position at the cap',
  rm.validateTrade(buy(), 33, 150, basePortfolio), true);

// Max open positions.
const full: PortfolioState = {
  ...basePortfolio,
  positions: ['X', 'Y', 'Z'].map(symbol => ({
    symbol, quantity: 1, entryPrice: 1, currentPrice: 1,
    marketValue: 1, unrealizedPnL: 0, side: 'long' as const,
  })),
};
expect('blocks when at max open positions', rm.validateTrade(buy(), 20, 150, full), false);

// No averaging up into an existing position.
const holdingAapl: PortfolioState = {
  ...basePortfolio,
  positions: [{
    symbol: 'AAPL', quantity: 10, entryPrice: 150, currentPrice: 155,
    marketValue: 1550, unrealizedPnL: 50, side: 'long',
  }],
};
expect('blocks averaging up', rm.validateTrade(buy('AAPL'), 20, 150, holdingAapl), false);

// Confidence threshold.
expect('blocks low-confidence signal', rm.validateTrade(buy('AAPL', 0.3), 20, 150, basePortfolio), false);

// Symbol allowlist.
expect('blocks symbol outside allowlist', rm.validateTrade(buy('TSLA'), 20, 150, basePortfolio), false);

// Buying power: margin account where buying power exceeds equity.
// 5% of equity = 5000, so a 6000 order must still be blocked even though
// buying power (200k) would cover it. This is the leverage guard.
const margin: PortfolioState = { ...basePortfolio, buyingPower: 200_000 };
expect('blocks leverage beyond equity-based size cap',
  rm.validateTrade(buy(), 40, 150, margin), false);

// Position sizing + stop-loss math.
console.log('\n--- sizing and stops ---');
const size = rm.calculatePositionSize(100_000, 150);
console.log(`position size at $150 on 100k equity: ${size} shares ($${(size * 150).toFixed(2)})`);
if (size !== 33) { console.log('FAIL expected 33 shares'); failures++; } else console.log('PASS  sizing = floor(5000/150) = 33');

const stopLong = rm.calculateStopLoss(150, true);
console.log(`long stop from $150 @ 2%: $${stopLong.toFixed(2)}`);
if (Math.abs(stopLong - 147) > 0.001) { console.log('FAIL expected 147'); failures++; } else console.log('PASS  long stop = 147');

const stopShort = rm.calculateStopLoss(150, false);
if (Math.abs(stopShort - 153) > 0.001) { console.log('FAIL expected 153'); failures++; } else console.log('PASS  short stop = 153');

console.log(failures === 0 ? '\nALL RISK CHECKS PASSED' : `\n${failures} RISK CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
