import {
  TradingConfig,
  Position,
  Trade,
  PortfolioState,
  MarketConditions,
  TradeSignal,
  TradingMetrics,
} from './types';
import { RiskManager } from './risk-manager';
import { MarketAnalyzer } from './market-analyzer';
import { Logger } from './logger';

export class SafeTradingAgent {
  private riskManager: RiskManager;
  private marketAnalyzer: MarketAnalyzer;
  private logger: Logger;
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private portfolioValue: number = 100000;
  private cash: number = 100000;

  constructor(
    private config: TradingConfig,
    logPath?: string
  ) {
    this.riskManager = new RiskManager(config);
    this.marketAnalyzer = new MarketAnalyzer();
    this.logger = new Logger(logPath || './trading-agent.log');

    this.validateConfig();
    this.logger.info('Trading agent initialized', { config: this.sanitizeConfig(config) });
  }

  async executeTrade(signal: TradeSignal, currentPrice: number): Promise<Trade | null> {
    const portfolioState = this.getPortfolioState();

    if (signal.action === 'hold') {
      this.logger.info(`Hold signal for ${signal.symbol}`, { confidence: signal.confidence });
      return null;
    }

    const validation = this.riskManager.validateTrade(
      signal.symbol,
      signal.suggestedQuantity,
      currentPrice,
      portfolioState
    );

    if (!validation.allowed) {
      this.logger.warn(`Trade rejected: ${signal.symbol}`, { reason: validation.reason });
      return null;
    }

    const stopLoss = this.riskManager.calculateStopLoss(
      currentPrice,
      signal.action === 'buy'
    );

    const stopLossValidation = this.riskManager.validateStopLoss(currentPrice, stopLoss);
    if (!stopLossValidation.valid) {
      this.logger.warn(`Invalid stop loss: ${signal.symbol}`, {
        reason: stopLossValidation.reason,
      });
      return null;
    }

    if (this.config.paperTrading) {
      this.logger.info(`[PAPER] Executing ${signal.action} trade`, {
        symbol: signal.symbol,
        quantity: signal.suggestedQuantity,
        price: currentPrice,
        stopLoss,
      });
    } else {
      this.logger.info(`[LIVE] Executing ${signal.action} trade`, {
        symbol: signal.symbol,
        quantity: signal.suggestedQuantity,
        price: currentPrice,
        stopLoss,
      });
    }

    const trade = this.createTrade(
      signal.symbol,
      signal.action,
      signal.suggestedQuantity,
      currentPrice,
      signal.reason
    );

    if (signal.action === 'buy') {
      this.buyPosition(signal.symbol, signal.suggestedQuantity, currentPrice, stopLoss);
    } else {
      this.sellPosition(signal.symbol, signal.suggestedQuantity, currentPrice);
    }

    this.trades.push(trade);
    return trade;
  }

  analyzeTradingOpportunity(
    symbol: string,
    priceHistory: number[],
    volumeHistory: number[],
    rsi: number,
    macd: number
  ): TradeSignal {
    const marketConditions = this.marketAnalyzer.analyzeMarketConditions(
      priceHistory,
      volumeHistory,
      rsi,
      macd
    );

    if (!this.marketAnalyzer.isTradingConditionFavorable(marketConditions)) {
      this.logger.warn(`Unfavorable trading conditions for ${symbol}`, {
        volatility: marketConditions.volatility,
        volume: marketConditions.volume,
      });
      return {
        symbol,
        action: 'hold',
        confidence: 0,
        reason: 'Unfavorable market conditions',
        suggestedQuantity: 0,
        riskLevel: 'high',
      };
    }

    return this.marketAnalyzer.generateSignal(symbol, marketConditions, priceHistory);
  }

  closeLossingPositions(currentPrices: Map<string, number>): Trade[] {
    const closedTrades: Trade[] = [];

    for (const [symbol, position] of this.positions) {
      const currentPrice = currentPrices.get(symbol);
      if (!currentPrice) continue;

      if (currentPrice <= position.stopLoss) {
        this.logger.warn(`Stop loss triggered for ${symbol}`, {
          entryPrice: position.entryPrice,
          stopLoss: position.stopLoss,
          currentPrice,
          loss: currentPrice - position.entryPrice,
        });

        const trade = this.createTrade(
          symbol,
          'sell',
          position.quantity,
          currentPrice,
          'Stop loss triggered'
        );

        this.cash += currentPrice * position.quantity;
        position.status = 'closed';
        closedTrades.push(trade);
        this.trades.push(trade);
      }
    }

    return closedTrades;
  }

  getPortfolioState(): PortfolioState {
    const openPositions = Array.from(this.positions.values()).filter(p => p.status === 'open');
    const positionValue = openPositions.reduce((sum, p) => sum + p.currentPrice * p.quantity, 0);
    const totalValue = this.cash + positionValue;

    const winningTrades = this.trades.filter(t => {
      const matchingPosition = openPositions.find(p => p.symbol === t.symbol);
      return matchingPosition && matchingPosition.currentPrice > t.price;
    });

    return {
      totalValue,
      cash: this.cash,
      positions: openPositions,
      dailyPnL: this.calculateDailyPnL(),
      winRate: this.trades.length > 0 ? (winningTrades.length / this.trades.length) * 100 : 0,
      totalTrades: this.trades.length,
    };
  }

  getMetrics(): TradingMetrics {
    const portfolioState = this.getPortfolioState();

    return {
      maxDrawdown: this.calculateMaxDrawdown(),
      sharpeRatio: this.calculateSharpeRatio(),
      winRate: portfolioState.winRate,
      averageRiskReward: this.calculateAverageRiskReward(),
      totalPnL: portfolioState.totalValue - 100000,
    };
  }

  updatePositionPrices(currentPrices: Map<string, number>): void {
    for (const [symbol, position] of this.positions) {
      const currentPrice = currentPrices.get(symbol);
      if (currentPrice) {
        position.currentPrice = currentPrice;
      }
    }
  }

  private buyPosition(
    symbol: string,
    quantity: number,
    price: number,
    stopLoss: number
  ): void {
    const cost = quantity * price;
    if (cost > this.cash) {
      this.logger.warn(`Insufficient funds for ${symbol}`, { available: this.cash, needed: cost });
      return;
    }

    this.cash -= cost;
    const position: Position = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      quantity,
      entryPrice: price,
      currentPrice: price,
      stopLoss,
      createdAt: new Date(),
      status: 'open',
    };

    this.positions.set(symbol, position);
    this.logger.info(`Position opened: ${symbol}`, { quantity, price, stopLoss });
  }

  private sellPosition(symbol: string, quantity: number, price: number): void {
    const position = this.positions.get(symbol);
    if (!position) {
      this.logger.warn(`No position to sell for ${symbol}`);
      return;
    }

    const proceeds = quantity * price;
    this.cash += proceeds;
    position.quantity -= quantity;

    if (position.quantity <= 0) {
      position.status = 'closed';
    }

    this.logger.info(`Position reduced: ${symbol}`, { quantity, price, remaining: position.quantity });
  }

  private createTrade(
    symbol: string,
    type: 'buy' | 'sell',
    quantity: number,
    price: number,
    reason: string
  ): Trade {
    return {
      id: `${symbol}-${type}-${Date.now()}`,
      symbol,
      type,
      quantity,
      price,
      timestamp: new Date(),
      reason,
      paperTrading: this.config.paperTrading,
    };
  }

  private calculateDailyPnL(): number {
    const today = new Date().toDateString();
    const todaysTrades = this.trades.filter(t => t.timestamp.toDateString() === today);
    let pnl = 0;

    for (let i = 0; i < todaysTrades.length; i += 2) {
      const buyTrade = todaysTrades[i];
      const sellTrade = todaysTrades[i + 1];

      if (sellTrade) {
        pnl += (sellTrade.price - buyTrade.price) * buyTrade.quantity;
      }
    }

    return pnl;
  }

  private calculateMaxDrawdown(): number {
    if (this.trades.length === 0) return 0;

    let peak = 100000;
    let maxDD = 0;
    let currentValue = 100000;

    for (const trade of this.trades) {
      if (trade.type === 'sell') {
        const pnl = (trade.price - trade.price) * trade.quantity;
        currentValue += pnl;
      }

      if (currentValue > peak) peak = currentValue;

      const drawdown = ((peak - currentValue) / peak) * 100;
      if (drawdown > maxDD) maxDD = drawdown;
    }

    return maxDD;
  }

  private calculateSharpeRatio(): number {
    if (this.trades.length < 2) return 0;

    const returns = [];
    for (let i = 1; i < this.trades.length; i++) {
      const prevValue = this.trades[i - 1].price * this.trades[i - 1].quantity;
      const currValue = this.trades[i].price * this.trades[i].quantity;
      returns.push((currValue - prevValue) / prevValue);
    }

    const avgReturn = returns.reduce((a, b) => a + b) / returns.length;
    const variance = returns.reduce((sq, r) => sq + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  }

  private calculateAverageRiskReward(): number {
    if (this.trades.length === 0) return 0;

    const positions = Array.from(this.positions.values());
    const totalRiskReward = positions.reduce((sum, p) => {
      const risk = Math.abs(p.entryPrice - p.stopLoss);
      const reward = p.takeProfit ? Math.abs(p.takeProfit - p.entryPrice) : risk;
      return sum + reward / risk;
    }, 0);

    return positions.length > 0 ? totalRiskReward / positions.length : 0;
  }

  private validateConfig(): void {
    if (this.config.maxDailyLossPercent <= 0 || this.config.maxDailyLossPercent > 100) {
      throw new Error('maxDailyLossPercent must be between 0 and 100');
    }

    if (this.config.maxPositionSizePercent <= 0 || this.config.maxPositionSizePercent > 100) {
      throw new Error('maxPositionSizePercent must be between 0 and 100');
    }

    if (this.config.maxOpenPositions <= 0) {
      throw new Error('maxOpenPositions must be positive');
    }

    if (this.config.minStopLossPercent <= 0) {
      throw new Error('minStopLossPercent must be positive');
    }
  }

  private sanitizeConfig(config: TradingConfig): Partial<TradingConfig> {
    const sanitized = { ...config };
    delete (sanitized as any).apiKey;
    delete (sanitized as any).apiSecret;
    return sanitized;
  }
}
