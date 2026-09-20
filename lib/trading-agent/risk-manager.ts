import { Position, TradingConfig, PortfolioState } from './types';

export class RiskManager {
  private dailyLoss: number = 0;
  private dailyLossResetTime: Date = new Date();

  constructor(private config: TradingConfig) {
    this.resetDailyLoss();
  }

  validateTrade(
    symbol: string,
    quantity: number,
    price: number,
    portfolioState: PortfolioState
  ): { allowed: boolean; reason?: string } {
    if (!this.config.enableRiskManagement) {
      return { allowed: true };
    }

    if (this.isDailyLossTooHigh(portfolioState.totalValue)) {
      return {
        allowed: false,
        reason: `Daily loss limit (${this.config.maxDailyLossPercent}%) exceeded`,
      };
    }

    if (
      portfolioState.positions.length >=
      this.config.maxOpenPositions
    ) {
      return {
        allowed: false,
        reason: `Max open positions (${this.config.maxOpenPositions}) reached`,
      };
    }

    const positionValue = quantity * price;
    const positionPercent = (positionValue / portfolioState.totalValue) * 100;

    if (positionPercent > this.config.maxPositionSizePercent) {
      return {
        allowed: false,
        reason: `Position size (${positionPercent.toFixed(2)}%) exceeds max (${this.config.maxPositionSizePercent}%)`,
      };
    }

    if (this.config.allowedSymbols && !this.config.allowedSymbols.includes(symbol)) {
      return {
        allowed: false,
        reason: `${symbol} not in allowed symbols list`,
      };
    }

    return { allowed: true };
  }

  validateStopLoss(
    entryPrice: number,
    stopLoss: number
  ): { valid: boolean; reason?: string } {
    const stopLossPercent = Math.abs((stopLoss - entryPrice) / entryPrice) * 100;

    if (stopLossPercent < this.config.minStopLossPercent) {
      return {
        valid: false,
        reason: `Stop loss (${stopLossPercent.toFixed(2)}%) below minimum (${this.config.minStopLossPercent}%)`,
      };
    }

    return { valid: true };
  }

  calculateOptimalPositionSize(
    accountValue: number,
    riskPercent: number,
    stopLossPercent: number
  ): number {
    const riskAmount = (accountValue * riskPercent) / 100;
    const positionSize = riskAmount / (stopLossPercent / 100);
    const maxSize = (accountValue * this.config.maxPositionSizePercent) / 100;

    return Math.min(positionSize, maxSize);
  }

  calculateStopLoss(
    entryPrice: number,
    isLongPosition: boolean
  ): number {
    const stopLossPercent = this.config.minStopLossPercent;

    if (isLongPosition) {
      return entryPrice * (1 - stopLossPercent / 100);
    } else {
      return entryPrice * (1 + stopLossPercent / 100);
    }
  }

  updateDailyLoss(loss: number): void {
    this.resetDailyLossIfNeeded();
    this.dailyLoss += loss;
  }

  private isDailyLossTooHigh(portfolioValue: number): boolean {
    const maxDailyLoss = (portfolioValue * this.config.maxDailyLossPercent) / 100;
    return this.dailyLoss > maxDailyLoss;
  }

  private resetDailyLossIfNeeded(): void {
    const now = new Date();
    const daysSinceReset = Math.floor(
      (now.getTime() - this.dailyLossResetTime.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceReset >= 1) {
      this.resetDailyLoss();
    }
  }

  private resetDailyLoss(): void {
    this.dailyLoss = 0;
    this.dailyLossResetTime = new Date();
  }

  getDailyLoss(): number {
    this.resetDailyLossIfNeeded();
    return this.dailyLoss;
  }
}
