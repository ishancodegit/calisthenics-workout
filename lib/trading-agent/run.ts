import { SafeTradingAgent, TradingConfig } from './index';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Single trading cycle runner for GitHub Actions or scheduled execution
 * Executes once per scheduled run, then exits
 */

const LOG_PATH = process.env.LOG_PATH || './logs/trading-agent.log';

// Ensure logs directory exists
const logsDir = path.dirname(LOG_PATH);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const config: TradingConfig = {
  apiKey: process.env.TRADING_API_KEY || '',
  apiSecret: process.env.TRADING_API_SECRET || '',
  paperTrading: process.env.PAPER_TRADING !== 'false',
  maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '2'),
  maxPositionSizePercent: parseFloat(process.env.MAX_POSITION_SIZE_PERCENT || '5'),
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '5'),
  minStopLossPercent: parseFloat(process.env.MIN_STOP_LOSS_PERCENT || '1.5'),
  enableAutoStopLoss: process.env.ENABLE_AUTO_STOP_LOSS !== 'false',
  enableRiskManagement: process.env.ENABLE_RISK_MANAGEMENT !== 'false',
  maxLeverage: parseFloat(process.env.MAX_LEVERAGE || '1'),
  allowedSymbols: process.env.ALLOWED_SYMBOLS ? process.env.ALLOWED_SYMBOLS.split(',') : undefined,
};

async function runTradingCycle() {
  console.log('='.repeat(60));
  console.log('📈 Trading Agent - Scheduled Run');
  console.log(`⏰ ${new Date().toISOString()}`);
  console.log(`📊 Mode: ${config.paperTrading ? 'PAPER TRADING' : 'LIVE TRADING'}`);
  console.log('='.repeat(60));
  console.log('');

  const agent = new SafeTradingAgent(config, LOG_PATH);

  try {
    // Example: Check portfolio status
    const portfolio = agent.getPortfolioState();
    console.log('📊 Portfolio Status:');
    console.log(`  Total Value: $${portfolio.totalValue.toFixed(2)}`);
    console.log(`  Cash: $${portfolio.cash.toFixed(2)}`);
    console.log(`  Open Positions: ${portfolio.positions.length}`);
    console.log(`  Daily PnL: $${portfolio.dailyPnL.toFixed(2)}`);
    console.log(`  Win Rate: ${portfolio.winRate.toFixed(1)}%`);
    console.log('');

    // Example: Analyze a symbol
    const symbol = 'AAPL';
    const mockPrices = [150, 151, 152, 151.5, 153];
    const mockVolumes = [2000000, 2100000, 2200000, 2150000, 2300000];

    console.log(`📍 Analyzing ${symbol}...`);
    const signal = agent.analyzeTradingOpportunity(symbol, mockPrices, mockVolumes, 45, 0.5);

    console.log(`  Action: ${signal.action}`);
    console.log(`  Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
    console.log(`  Risk Level: ${signal.riskLevel}`);
    console.log(`  Reason: ${signal.reason}`);
    console.log('');

    // In production, you would:
    // 1. Fetch real price data from your broker API
    // 2. Analyze multiple symbols
    // 3. Execute trades for strong signals
    // 4. Monitor existing positions
    // 5. Check stop-losses

    const metrics = agent.getMetrics();
    console.log('📈 Performance Metrics:');
    console.log(`  Sharpe Ratio: ${metrics.sharpeRatio.toFixed(3)}`);
    console.log(`  Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}%`);
    console.log(`  Total PnL: $${metrics.totalPnL.toFixed(2)}`);
    console.log(`  Win Rate: ${metrics.winRate.toFixed(1)}%`);
    console.log('');

    console.log('✅ Trading cycle completed successfully');
    console.log(`📝 Logs saved to: ${LOG_PATH}`);
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during trading cycle:', error);
    console.error('');
    process.exit(1);
  }
}

// Run the trading cycle
runTradingCycle();
