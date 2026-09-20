import { MarketConditions, TradeSignal } from './types';

export class MarketAnalyzer {
  analyzeMarketConditions(
    prices: number[],
    volumes: number[],
    rsi: number,
    macd: number
  ): MarketConditions {
    const volatility = this.calculateVolatility(prices);
    const trend = this.determineTrend(prices);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    return {
      volatility,
      trend,
      volume: avgVolume,
      rsi,
      macd,
    };
  }

  generateSignal(
    symbol: string,
    marketConditions: MarketConditions,
    priceHistory: number[]
  ): TradeSignal {
    const signals = [];
    let confidence = 0;

    if (this.isOversold(marketConditions.rsi)) {
      signals.push('oversold');
      confidence += 0.3;
    }

    if (this.isOverbought(marketConditions.rsi)) {
      signals.push('overbought');
      confidence -= 0.3;
    }

    if (marketConditions.macd > 0) {
      signals.push('bullish_macd');
      confidence += 0.2;
    }

    if (marketConditions.macd < 0) {
      signals.push('bearish_macd');
      confidence -= 0.2;
    }

    if (marketConditions.trend === 'bullish') {
      confidence += 0.2;
    } else if (marketConditions.trend === 'bearish') {
      confidence -= 0.2;
    }

    confidence = Math.max(-1, Math.min(1, confidence));

    const action = confidence > 0.3 ? 'buy' : confidence < -0.3 ? 'sell' : 'hold';
    const riskLevel = this.assessRiskLevel(marketConditions);
    const suggestedQuantity = this.calculateQuantity(confidence, riskLevel);

    return {
      symbol,
      action,
      confidence: Math.abs(confidence),
      reason: signals.join(', '),
      suggestedQuantity,
      riskLevel,
    };
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const mean = prices.reduce((a, b) => a + b) / prices.length;
    const variance = prices.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / prices.length;
    return Math.sqrt(variance) / mean;
  }

  private determineTrend(prices: number[]): 'bullish' | 'bearish' | 'neutral' {
    if (prices.length < 3) return 'neutral';

    const shortTermAvg = prices.slice(-5).reduce((a, b) => a + b) / 5;
    const longTermAvg = prices.reduce((a, b) => a + b) / prices.length;

    const diff = ((shortTermAvg - longTermAvg) / longTermAvg) * 100;

    if (diff > 2) return 'bullish';
    if (diff < -2) return 'bearish';
    return 'neutral';
  }

  private isOversold(rsi: number): boolean {
    return rsi < 30;
  }

  private isOverbought(rsi: number): boolean {
    return rsi > 70;
  }

  private assessRiskLevel(marketConditions: MarketConditions): 'low' | 'medium' | 'high' {
    if (marketConditions.volatility > 0.05 || Math.abs(marketConditions.rsi - 50) > 30) {
      return 'high';
    }
    if (marketConditions.volatility > 0.02) {
      return 'medium';
    }
    return 'low';
  }

  private calculateQuantity(confidence: number, riskLevel: 'low' | 'medium' | 'high'): number {
    const baseQuantity = 1;
    const confidenceMultiplier = confidence;
    const riskMultiplier = riskLevel === 'low' ? 1 : riskLevel === 'medium' ? 0.7 : 0.4;

    return Math.round(baseQuantity * confidenceMultiplier * riskMultiplier * 100) / 100;
  }

  isTradingConditionFavorable(marketConditions: MarketConditions): boolean {
    if (marketConditions.volatility > 0.1) {
      return false;
    }

    if (marketConditions.volume < 100000) {
      return false;
    }

    return true;
  }
}
