import { MarketConditions, TradeSignal } from './types';

const OVERSOLD = 30;
const OVERBOUGHT = 70;
const MAX_TRADEABLE_VOLATILITY = 0.08;
const MIN_AVERAGE_VOLUME = 100_000;

export class MarketAnalyzer {
  analyzeMarketConditions(
    closes: number[],
    volumes: number[],
    rsi: number,
    macdHistogram: number
  ): MarketConditions {
    return {
      volatility: this.calculateVolatility(closes),
      trend: this.determineTrend(closes),
      averageVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length,
      rsi,
      macdHistogram,
    };
  }

  generateSignal(symbol: string, conditions: MarketConditions): TradeSignal {
    const reasons: string[] = [];
    let score = 0;

    if (conditions.rsi < OVERSOLD) {
      reasons.push(`oversold (RSI ${conditions.rsi.toFixed(1)})`);
      score += 0.35;
    } else if (conditions.rsi > OVERBOUGHT) {
      reasons.push(`overbought (RSI ${conditions.rsi.toFixed(1)})`);
      score -= 0.35;
    }

    if (conditions.macdHistogram > 0) {
      reasons.push('MACD above signal');
      score += 0.25;
    } else if (conditions.macdHistogram < 0) {
      reasons.push('MACD below signal');
      score -= 0.25;
    }

    if (conditions.trend === 'bullish') {
      reasons.push('uptrend');
      score += 0.2;
    } else if (conditions.trend === 'bearish') {
      reasons.push('downtrend');
      score -= 0.2;
    }

    score = Math.max(-1, Math.min(1, score));

    const action = score >= 0.3 ? 'buy' : score <= -0.3 ? 'sell' : 'hold';

    return {
      symbol,
      action,
      confidence: Math.abs(score),
      reason: reasons.length ? reasons.join(', ') : 'no directional signal',
      riskLevel: this.assessRiskLevel(conditions),
    };
  }

  isTradingConditionFavorable(conditions: MarketConditions): { ok: boolean; reason?: string } {
    if (conditions.volatility > MAX_TRADEABLE_VOLATILITY) {
      return {
        ok: false,
        reason: `Volatility ${(conditions.volatility * 100).toFixed(1)}% above ${MAX_TRADEABLE_VOLATILITY * 100}% ceiling`,
      };
    }

    if (conditions.averageVolume < MIN_AVERAGE_VOLUME) {
      return {
        ok: false,
        reason: `Average volume ${Math.round(conditions.averageVolume)} below ${MIN_AVERAGE_VOLUME} floor`,
      };
    }

    return { ok: true };
  }

  /** Standard deviation of daily returns, not of raw price. */
  private calculateVolatility(closes: number[]): number {
    if (closes.length < 2) return 0;

    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  private determineTrend(closes: number[]): 'bullish' | 'bearish' | 'neutral' {
    if (closes.length < 20) return 'neutral';

    const short = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const long = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const diff = ((short - long) / long) * 100;

    if (diff > 1) return 'bullish';
    if (diff < -1) return 'bearish';
    return 'neutral';
  }

  private assessRiskLevel(conditions: MarketConditions): 'low' | 'medium' | 'high' {
    if (conditions.volatility > 0.04) return 'high';
    if (conditions.volatility > 0.02) return 'medium';
    return 'low';
  }
}
