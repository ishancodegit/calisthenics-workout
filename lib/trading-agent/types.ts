export interface TradingConfig {
  apiKey: string;
  apiSecret: string;
  paperTrading: boolean;
  maxDailyLossPercent: number;
  maxPositionSizePercent: number;
  maxOpenPositions: number;
  minStopLossPercent: number;
  enableAutoStopLoss: boolean;
  enableRiskManagement: boolean;
  maxLeverage: number;
  allowedSymbols?: string[];
}

export interface MarketConditions {
  volatility: number;
  trend: 'bullish' | 'bearish' | 'neutral';
  volume: number;
  rsi: number;
  macd: number;
}

export interface Position {
  id: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit?: number;
  createdAt: Date;
  status: 'open' | 'closed';
}

export interface Trade {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  reason: string;
  paperTrading: boolean;
}

export interface TradeSignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: number;
  reason: string;
  suggestedQuantity: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface PortfolioState {
  totalValue: number;
  cash: number;
  positions: Position[];
  dailyPnL: number;
  winRate: number;
  totalTrades: number;
}

export interface TradingMetrics {
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  averageRiskReward: number;
  totalPnL: number;
}
