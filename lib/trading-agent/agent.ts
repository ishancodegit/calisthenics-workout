import { TradingConfig, PortfolioState, TradeSignal, Position } from './types';
import { RiskManager } from './risk-manager';
import { MarketAnalyzer } from './market-analyzer';
import { Logger } from './logger';
import { AlpacaClient, AlpacaOrder } from './alpaca-client';
import { calculateRSI, calculateMACD, MIN_BARS_REQUIRED } from './indicators';

export interface TradeDecision {
  signal: TradeSignal;
  executed: boolean;
  order?: AlpacaOrder;
  rejectedReason?: string;
}

export class SafeTradingAgent {
  private readonly riskManager: RiskManager;
  private readonly marketAnalyzer: MarketAnalyzer;

  constructor(
    private readonly config: TradingConfig,
    private readonly broker: AlpacaClient,
    private readonly logger: Logger
  ) {
    this.validateConfig();
    this.logger.info('Trading agent initialized', { config: this.sanitizeConfig(config) });
    this.riskManager = new RiskManager(config);
    this.marketAnalyzer = new MarketAnalyzer();
  }

  /**
   * Reads live account and position state from the broker. Risk limits are
   * meaningless unless they are checked against the real balance, so this is
   * always fetched fresh rather than tracked in process.
   */
  async getPortfolioState(): Promise<PortfolioState> {
    const [account, brokerPositions] = await Promise.all([
      this.broker.getAccount(),
      this.broker.getPositions(),
    ]);

    const positions: Position[] = brokerPositions.map(p => ({
      symbol: p.symbol,
      quantity: p.qty,
      entryPrice: p.avgEntryPrice,
      currentPrice: p.currentPrice,
      marketValue: p.marketValue,
      unrealizedPnL: p.unrealizedPl,
      side: p.side,
    }));

    return {
      equity: account.equity,
      cash: account.cash,
      buyingPower: account.buyingPower,
      positions,
      dailyPnL: account.equity - account.lastEquity,
      unrealizedPnL: positions.reduce((sum, p) => sum + p.unrealizedPnL, 0),
    };
  }

  /**
   * Refuses to trade unless the broker says the account is in good standing
   * and the market is open. Returns the reason when it refuses.
   */
  async checkTradingAllowed(): Promise<{ allowed: boolean; reason?: string }> {
    const [account, clock] = await Promise.all([
      this.broker.getAccount(),
      this.broker.getClock(),
    ]);

    if (account.accountBlocked) return { allowed: false, reason: 'Account is blocked' };
    if (account.tradingBlocked) return { allowed: false, reason: 'Trading is blocked on this account' };
    if (account.tradeSuspendedByUser) return { allowed: false, reason: 'Trading suspended by user' };
    if (account.status !== 'ACTIVE') return { allowed: false, reason: `Account status is ${account.status}` };
    if (!clock.isOpen) return { allowed: false, reason: `Market closed until ${clock.nextOpen}` };

    return { allowed: true };
  }

  analyzeSymbol(symbol: string, closes: number[], volumes: number[]): TradeSignal {
    if (closes.length < MIN_BARS_REQUIRED) {
      return {
        symbol,
        action: 'hold',
        confidence: 0,
        reason: `Insufficient history (${closes.length}/${MIN_BARS_REQUIRED} bars)`,
        riskLevel: 'high',
      };
    }

    const rsi = calculateRSI(closes);
    const { histogram } = calculateMACD(closes);
    const conditions = this.marketAnalyzer.analyzeMarketConditions(closes, volumes, rsi, histogram);

    const favorable = this.marketAnalyzer.isTradingConditionFavorable(conditions);
    if (!favorable.ok) {
      return {
        symbol,
        action: 'hold',
        confidence: 0,
        reason: favorable.reason!,
        riskLevel: 'high',
      };
    }

    return this.marketAnalyzer.generateSignal(symbol, conditions);
  }

  /**
   * Validates a signal against live account state and, if it passes, submits a
   * bracket order so the stop-loss is held by the broker rather than by this
   * process, which is not running between scheduled invocations.
   */
  async executeSignal(
    signal: TradeSignal,
    currentPrice: number,
    portfolio: PortfolioState
  ): Promise<TradeDecision> {
    if (signal.action === 'hold') {
      return { signal, executed: false, rejectedReason: 'Hold signal' };
    }

    // Only long entries are supported. Shorting has a different risk profile
    // (unbounded loss) that these limits are not designed for.
    if (signal.action === 'sell') {
      const held = portfolio.positions.find(p => p.symbol === signal.symbol);
      if (!held) {
        return { signal, executed: false, rejectedReason: 'Sell signal with no open position; shorting is disabled' };
      }
    }

    const stopLoss = this.riskManager.calculateStopLoss(currentPrice, signal.action === 'buy');
    const quantity = this.riskManager.calculatePositionSize(portfolio.equity, currentPrice);

    if (quantity < 1) {
      return {
        signal,
        executed: false,
        rejectedReason: `Position size rounds to ${quantity} shares at $${currentPrice.toFixed(2)}`,
      };
    }

    const validation = this.riskManager.validateTrade(signal, quantity, currentPrice, portfolio);
    if (!validation.allowed) {
      this.logger.warn(`Trade rejected: ${signal.symbol}`, { reason: validation.reason });
      return { signal, executed: false, rejectedReason: validation.reason };
    }

    this.logger.info(`Submitting ${signal.action} order`, {
      symbol: signal.symbol,
      quantity,
      price: currentPrice,
      stopLoss: Number(stopLoss.toFixed(2)),
      paperTrading: this.broker.isPaperTrading(),
    });

    const order = await this.broker.submitBracketOrder({
      symbol: signal.symbol,
      qty: quantity,
      side: signal.action,
      stopLossPrice: stopLoss,
    });

    this.logger.info(`Order accepted: ${signal.symbol}`, {
      orderId: order.id,
      status: order.status,
      qty: order.qty,
    });

    return { signal, executed: true, order };
  }

  private validateConfig(): void {
    const { maxDailyLossPercent, maxPositionSizePercent, maxOpenPositions, minStopLossPercent } =
      this.config;

    if (!(maxDailyLossPercent > 0 && maxDailyLossPercent <= 100)) {
      throw new Error('maxDailyLossPercent must be between 0 and 100');
    }
    if (!(maxPositionSizePercent > 0 && maxPositionSizePercent <= 100)) {
      throw new Error('maxPositionSizePercent must be between 0 and 100');
    }
    if (!(maxOpenPositions > 0)) {
      throw new Error('maxOpenPositions must be positive');
    }
    if (!(minStopLossPercent > 0)) {
      throw new Error('minStopLossPercent must be positive');
    }
  }

  private sanitizeConfig(config: TradingConfig): Record<string, unknown> {
    const { apiKey, apiSecret, ...safe } = config;
    return safe;
  }
}
