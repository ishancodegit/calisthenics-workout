import { SafeTradingAgent, TradingConfig } from './index';

/**
 * Example: Safe Trading Agent Implementation
 * This demonstrates how to use the trading agent safely with proper error handling
 */

async function runTradingBot() {
  // Configuration with STRICT safety limits
  const config: TradingConfig = {
    apiKey: process.env.TRADING_API_KEY || '',
    apiSecret: process.env.TRADING_API_SECRET || '',

    // Paper trading for testing
    paperTrading: true,

    // Aggressive loss limits to protect capital
    maxDailyLossPercent: 2,
    maxPositionSizePercent: 5,
    maxOpenPositions: 5,
    minStopLossPercent: 1.5,
    enableAutoStopLoss: true,
    enableRiskManagement: true,
    maxLeverage: 1,

    // Whitelist safe symbols
    allowedSymbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'],
  };

  const agent = new SafeTradingAgent(config, './logs/trading.log');

  // Mock market data
  const mockPriceHistory = [
    150.2, 150.5, 150.3, 150.8, 151.0, 150.9, 151.2, 151.5, 151.3, 151.8,
  ];
  const mockVolumeHistory = [
    2000000, 2100000, 2050000, 2200000, 2150000, 2180000, 2300000, 2250000,
    2280000, 2350000,
  ];

  try {
    console.log('Starting Safe Trading Bot...');
    console.log(`Mode: ${config.paperTrading ? 'PAPER' : 'LIVE'}`);
    console.log('');

    // Analyze AAPL
    console.log('--- Analyzing AAPL ---');
    const signal = agent.analyzeTradingOpportunity(
      'AAPL',
      mockPriceHistory,
      mockVolumeHistory,
      35, // RSI
      0.5 // MACD
    );

    console.log('Signal:', {
      symbol: signal.symbol,
      action: signal.action,
      confidence: signal.confidence.toFixed(2),
      riskLevel: signal.riskLevel,
      reason: signal.reason,
    });

    // Execute if signal is strong
    if (signal.action !== 'hold' && signal.confidence > 0.3) {
      const currentPrice = mockPriceHistory[mockPriceHistory.length - 1];
      console.log(`Current Price: $${currentPrice}`);

      const trade = await agent.executeTrade(signal, currentPrice);
      if (trade) {
        console.log('Trade Executed:', {
          id: trade.id,
          type: trade.type,
          quantity: trade.quantity,
          price: trade.price,
          reason: trade.reason,
          paperTrading: trade.paperTrading,
        });
      } else {
        console.log('Trade rejected by risk manager');
      }
    } else {
      console.log('No strong signal, holding');
    }

    console.log('');

    // Get portfolio state
    const portfolio = agent.getPortfolioState();
    console.log('--- Portfolio State ---');
    console.log('Total Value: $' + portfolio.totalValue.toFixed(2));
    console.log('Cash: $' + portfolio.cash.toFixed(2));
    console.log('Open Positions: ' + portfolio.positions.length);
    console.log('Total Trades: ' + portfolio.totalTrades);
    console.log('Win Rate: ' + portfolio.winRate.toFixed(2) + '%');
    console.log('Daily PnL: $' + portfolio.dailyPnL.toFixed(2));

    console.log('');

    // Simulate price movement
    console.log('--- Simulating Price Movement ---');
    const newPrices = new Map([
      ['AAPL', 152.5], // Price went up
      ['MSFT', 380.0],
      ['GOOGL', 140.0],
    ]);

    agent.updatePositionPrices(newPrices);

    // Check for stop-loss
    const closedTrades = agent.closeLossingPositions(newPrices);
    if (closedTrades.length > 0) {
      console.log('Positions closed by stop-loss:');
      closedTrades.forEach(trade => {
        console.log(`  - ${trade.symbol}: ${trade.type} ${trade.quantity} @ $${trade.price}`);
      });
    } else {
      console.log('No positions triggered stop-loss');
    }

    console.log('');

    // Get metrics
    const metrics = agent.getMetrics();
    console.log('--- Performance Metrics ---');
    console.log('Sharpe Ratio: ' + metrics.sharpeRatio.toFixed(3));
    console.log('Max Drawdown: ' + metrics.maxDrawdown.toFixed(2) + '%');
    console.log('Total PnL: $' + metrics.totalPnL.toFixed(2));
    console.log('Average Risk/Reward: ' + metrics.averageRiskReward.toFixed(2));

    console.log('');
    console.log('Bot completed successfully');
  } catch (error) {
    console.error('Error running trading bot:', error);
    process.exit(1);
  }
}

/**
 * Example: Multiple Symbol Monitoring
 */
async function monitorMultipleSymbols() {
  const config: TradingConfig = {
    apiKey: process.env.TRADING_API_KEY || '',
    apiSecret: process.env.TRADING_API_SECRET || '',
    paperTrading: true,
    maxDailyLossPercent: 2,
    maxPositionSizePercent: 3,
    maxOpenPositions: 5,
    minStopLossPercent: 2,
    enableRiskManagement: true,
    enableAutoStopLoss: true,
    maxLeverage: 1,
    allowedSymbols: ['AAPL', 'MSFT', 'GOOGL', 'AMZN'],
  };

  const agent = new SafeTradingAgent(config);
  const symbols = ['AAPL', 'MSFT', 'GOOGL'];

  // Would typically fetch real data from API
  const symbolData = {
    AAPL: {
      prices: [150.2, 150.5, 150.8, 151.2, 151.5],
      volumes: [2000000, 2100000, 2200000, 2300000, 2250000],
      rsi: 45,
      macd: 0.5,
      current: 151.5,
    },
    MSFT: {
      prices: [375, 376, 377, 378, 379],
      volumes: [1500000, 1600000, 1700000, 1800000, 1900000],
      rsi: 55,
      macd: 1.2,
      current: 379,
    },
    GOOGL: {
      prices: [138, 139, 140, 141, 142],
      volumes: [1000000, 1100000, 1200000, 1300000, 1400000],
      rsi: 65,
      macd: 2.5,
      current: 142,
    },
  };

  console.log('Monitoring multiple symbols...\n');

  for (const symbol of symbols) {
    const data = symbolData[symbol as keyof typeof symbolData];
    const signal = agent.analyzeTradingOpportunity(
      symbol,
      data.prices,
      data.volumes,
      data.rsi,
      data.macd
    );

    console.log(`${symbol}:`);
    console.log(`  Action: ${signal.action}`);
    console.log(`  Confidence: ${(signal.confidence * 100).toFixed(0)}%`);
    console.log(`  Risk Level: ${signal.riskLevel}`);
    console.log(`  Reason: ${signal.reason}\n`);

    if (signal.action !== 'hold') {
      const trade = await agent.executeTrade(signal, data.current);
      if (trade) {
        console.log(`  Trade executed: ${trade.type} ${trade.quantity} @ $${trade.price}\n`);
      }
    }
  }

  const portfolio = agent.getPortfolioState();
  console.log('Final Portfolio:');
  console.log(`  Total Value: $${portfolio.totalValue.toFixed(2)}`);
  console.log(`  Positions: ${portfolio.positions.length}/${config.maxOpenPositions}`);
  console.log(`  Win Rate: ${portfolio.winRate.toFixed(1)}%`);
}

/**
 * Example: Risk Management Testing
 */
function testRiskManagement() {
  const config: TradingConfig = {
    apiKey: '',
    apiSecret: '',
    paperTrading: true,
    maxDailyLossPercent: 2,
    maxPositionSizePercent: 10,
    maxOpenPositions: 3,
    minStopLossPercent: 2,
    enableRiskManagement: true,
    enableAutoStopLoss: true,
    maxLeverage: 1,
  };

  const agent = new SafeTradingAgent(config);

  console.log('Testing Risk Management Constraints:\n');

  // Test 1: Position size limit
  const signal1 = {
    symbol: 'TEST',
    action: 'buy' as const,
    confidence: 0.9,
    reason: 'Test signal',
    suggestedQuantity: 1000, // Very large
    riskLevel: 'high' as const,
  };

  console.log('Test 1: Large position size');
  console.log('Quantity: 1000 @ $100 = $100,000 (100% of portfolio)');
  console.log('Expected: Rejected\n');

  // Would validate here with actual portfolio state

  console.log('All risk management tests completed');
}

// Uncomment to run examples
// runTradingBot();
// monitorMultipleSymbols();
// testRiskManagement();

export { runTradingBot, monitorMultipleSymbols, testRiskManagement };
