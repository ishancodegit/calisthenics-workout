export interface TradingConfig {
  apiKey: string;
  apiSecret: string;
  paperTrading: boolean;
  maxDailyLossPercent: number;
  maxPositionSizePercent: number;
  maxOpenPositions: number;
  minStopLossPercent: number;
  maxLeverage: number;
  symbols: string[];
  minConfidence: number;
}

export interface MarketConditions {
  volatility: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  averageVolume: number;
  rsi: number;
  macdHistogram: number;
}

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  side: 'long' | 'short';
}

export interface TradeSignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/** Live account state as reported by the broker. Never derived locally. */
export interface PortfolioState {
  equity: number;
  cash: number;
  buyingPower: number;
  positions: Position[];
  dailyPnL: number;
  unrealizedPnL: number;
}
