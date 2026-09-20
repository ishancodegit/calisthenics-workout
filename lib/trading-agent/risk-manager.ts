import { TradingConfig, PortfolioState, TradeSignal } from './types';

export interface RiskDecision {
  allowed: boolean;
  reason?: string;
}

export class RiskManager {
  constructor(private readonly config: TradingConfig) {}

  /**
   * Every check runs against live broker state, so the daily loss limit is
   * measured from the account's own equity change rather than from trades this
   * process happens to remember.
   */
  validateTrade(
    signal: TradeSignal,
    quantity: number,
    price: number,
    portfolio: PortfolioState
  ): RiskDecision {
    const dailyLossLimit = -(portfolio.equity * this.config.maxDailyLossPercent) / 100;
    if (portfolio.dailyPnL <= dailyLossLimit) {
      return {
        allowed: false,
        reason: `Daily loss ${portfolio.dailyPnL.toFixed(2)} hit limit ${dailyLossLimit.toFixed(2)} (${this.config.maxDailyLossPercent}% of equity)`,
      };
    }

    if (signal.confidence < this.config.minConfidence) {
      return {
        allowed: false,
        reason: `Confidence ${signal.confidence.toFixed(2)} below threshold ${this.config.minConfidence}`,
      };
    }

    const alreadyHeld = portfolio.positions.some(p => p.symbol === signal.symbol);

    if (signal.action === 'buy') {
      if (alreadyHeld) {
        return { allowed: false, reason: `Already holding ${signal.symbol}; no averaging up` };
      }

      if (portfolio.positions.length >= this.config.maxOpenPositions) {
        return {
          allowed: false,
          reason: `At max open positions (${this.config.maxOpenPositions})`,
        };
      }

      const cost = quantity * price;

      if (cost > portfolio.buyingPower) {
        return {
          allowed: false,
          reason: `Cost ${cost.toFixed(2)} exceeds buying power ${portfolio.buyingPower.toFixed(2)}`,
        };
      }

      // Buying power can exceed equity on a margin account. Sizing off equity
      // keeps the position within the configured share of real capital
      // instead of silently trading on leverage.
      const maxCost = (portfolio.equity * this.config.maxPositionSizePercent) / 100;
      if (cost > maxCost) {
        return {
          allowed: false,
          reason: `Cost ${cost.toFixed(2)} exceeds max position size ${maxCost.toFixed(2)} (${this.config.maxPositionSizePercent}% of equity)`,
        };
      }
    }

    if (!this.config.symbols.includes(signal.symbol)) {
      return { allowed: false, reason: `${signal.symbol} is not in the configured symbol list` };
    }

    return { allowed: true };
  }

  /** Whole shares that fit inside maxPositionSizePercent of equity. */
  calculatePositionSize(equity: number, price: number): number {
    const budget = (equity * this.config.maxPositionSizePercent) / 100;
    return Math.floor(budget / price);
  }

  calculateStopLoss(entryPrice: number, isLong: boolean): number {
    const offset = (entryPrice * this.config.minStopLossPercent) / 100;
    return isLong ? entryPrice - offset : entryPrice + offset;
  }
}
