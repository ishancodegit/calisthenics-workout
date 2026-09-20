# Safe Trading Agent

A TypeScript trading agent with built-in risk management, position limits, and
safety guardrails. Timeframe-agnostic: the same code handles swing and position
trading depending on how often you schedule it.

**Deployment:** runs on GitHub Actions on a schedule you pick. See
[DEPLOY_GITHUB_ACTIONS.md](./DEPLOY_GITHUB_ACTIONS.md).

**Status:** the strategy in `run.ts` is a scaffold using mock price data. It is
wired end to end and safe to run, but you must connect a real market-data source
before it can make meaningful decisions.

## Core Safety Features

### 1. Risk Management
- Daily loss limits with automatic reset
- Maximum position size constraints per trade
- Maximum concurrent open positions limit
- Minimum stop-loss percentage enforcement
- Leverage limits

### 2. Position Management
- Automatic stop-loss calculation
- Position size optimization based on risk
- Real-time position tracking
- Forced liquidation on stop-loss

### 3. Market Analysis
- Volatility assessment
- Trend detection (bullish/bearish/neutral)
- RSI (Relative Strength Index) monitoring
- MACD signal analysis
- Volume verification

### 4. Compliance & Logging
- Comprehensive audit trail of all trades
- JSON-formatted logs with timestamps
- Market condition validation
- Trade rejection reasons logged
- Paper trading mode for testing

## Configuration

```typescript
const config: TradingConfig = {
  apiKey: process.env.API_KEY || '',
  apiSecret: process.env.API_SECRET || '',
  
  // CRITICAL: Always use paper trading for testing
  paperTrading: true,
  
  // Risk Management
  maxDailyLossPercent: 2,           // Stop trading after 2% daily loss
  maxPositionSizePercent: 5,        // Max 5% of portfolio per position
  maxOpenPositions: 5,               // Max 5 concurrent trades
  minStopLossPercent: 1.5,           // Minimum 1.5% stop-loss
  maxLeverage: 1,                    // No leverage (1x only)
  
  // Safety
  enableRiskManagement: true,
  enableAutoStopLoss: true,
  allowedSymbols: ['AAPL', 'MSFT', 'GOOGL'], // Optional whitelist
};

const agent = new SafeTradingAgent(config, './logs/trading-agent.log');
```

## Usage Example

```typescript
import { SafeTradingAgent } from './lib/trading-agent';

const config = {
  apiKey: process.env.TRADING_API_KEY,
  apiSecret: process.env.TRADING_API_SECRET,
  paperTrading: true,
  maxDailyLossPercent: 2,
  maxPositionSizePercent: 5,
  maxOpenPositions: 5,
  minStopLossPercent: 1.5,
  enableRiskManagement: true,
  enableAutoStopLoss: true,
  maxLeverage: 1,
};

const agent = new SafeTradingAgent(config);

// Analyze market conditions
const signal = agent.analyzeTradingOpportunity(
  'AAPL',
  priceHistory,    // Array of historical prices
  volumeHistory,   // Array of historical volumes
  rsiValue,        // RSI indicator (0-100)
  macdValue        // MACD value
);

// Execute trade if signal is good
if (signal.confidence > 0.5) {
  const trade = await agent.executeTrade(signal, currentPrice);
  if (trade) {
    console.log('Trade executed:', trade);
  }
}

// Update prices and check stop-losses
agent.updatePositionPrices(new Map([['AAPL', currentPrice]]));
const closedTrades = agent.closeLossingPositions(new Map([['AAPL', currentPrice]]));

// Get portfolio status
const portfolio = agent.getPortfolioState();
console.log(`Portfolio value: $${portfolio.totalValue}`);
console.log(`Cash: $${portfolio.cash}`);
console.log(`Win rate: ${portfolio.winRate.toFixed(2)}%`);

// Get performance metrics
const metrics = agent.getMetrics();
console.log(`Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`);
console.log(`Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}%`);
console.log(`Total PnL: $${metrics.totalPnL.toFixed(2)}`);
```

## Safety Checklist Before Going Live

- [ ] Test extensively in paper trading mode
- [ ] Review all logs for unexpected behavior
- [ ] Verify risk limits are appropriate for your capital
- [ ] Set maxDailyLossPercent conservatively (1-3%)
- [ ] Ensure API credentials are in environment variables
- [ ] Never hardcode API keys or secrets
- [ ] Monitor positions in real-time
- [ ] Have manual kill switch ready
- [ ] Set position size limits (maxPositionSizePercent 2-5%)
- [ ] Verify stop-loss functionality with test trades
- [ ] Understand all configuration parameters
- [ ] Have backup communication channels setup
- [ ] Test with minimal capital first
- [ ] Review and understand the market analyzer logic
- [ ] Ensure trading within market hours

## Key Classes

### SafeTradingAgent
Main orchestrator for trading operations. Manages positions, executes trades, and monitors portfolio.

**Key Methods:**
- `executeTrade()`: Execute a trade with full validation
- `analyzeTradingOpportunity()`: Generate trading signals
- `closeLossingPositions()`: Monitor and close positions at stop-loss
- `getPortfolioState()`: Get current portfolio metrics
- `getMetrics()`: Calculate performance metrics

### RiskManager
Enforces all risk constraints and position sizing rules.

**Key Methods:**
- `validateTrade()`: Pre-trade safety check
- `validateStopLoss()`: Ensure minimum stop-loss
- `calculateOptimalPositionSize()`: Kelly-criterion inspired sizing
- `calculateStopLoss()`: Auto-calculate stop-loss price
- `updateDailyLoss()`: Track daily losses

### MarketAnalyzer
Analyzes market conditions and generates trading signals.

**Key Methods:**
- `analyzeMarketConditions()`: Assess current market state
- `generateSignal()`: Create buy/sell/hold signals
- `isTradingConditionFavorable()`: Check if market is suitable for trading

### Logger
Comprehensive audit trail and debugging logs.

**Key Methods:**
- `info()`, `warn()`, `error()`: Log events at different levels
- `readLogs()`: Query historical logs
- `clearLogs()`: Clear log file

## Trade Signal Structure

```typescript
interface TradeSignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  confidence: 0.0 to 1.0;      // Signal strength
  reason: string;               // Why this signal
  suggestedQuantity: number;    // How many shares
  riskLevel: 'low' | 'medium' | 'high';
}
```

## Position Structure

```typescript
interface Position {
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
```

## Error Handling

The agent returns validation errors instead of throwing:

```typescript
const validation = riskManager.validateTrade(...);
if (!validation.allowed) {
  console.log('Trade rejected:', validation.reason);
  // Handle rejection gracefully
}
```

## Recommendations

1. **Start in Paper Trading**: Always test strategies with `paperTrading: true`
2. **Conservative Limits**: Use 1-3% max daily loss initially
3. **Position Sizing**: Keep individual positions to 2-5% of portfolio
4. **Monitor Constantly**: Check logs and portfolio state frequently
5. **Small Capital First**: Start with minimal capital before scaling
6. **Market Hours Only**: Trade during liquid market hours
7. **Volatility Watch**: Avoid trading during high volatility spikes
8. **Regular Reviews**: Audit logs and performance metrics daily

## Limitations

- Uses simple technical indicators (RSI, MACD)
- Does not include advanced ML models
- Requires external price/volume data
- No automatic news sentiment analysis
- Does not handle market gaps perfectly
- Limited to margin constraints (1x leverage)

## Environment Variables

```bash
TRADING_API_KEY=your_api_key_here
TRADING_API_SECRET=your_api_secret_here
TRADING_LOG_PATH=./logs/trading-agent.log
```

Never commit these to version control. Use `.env` or `.env.local`.

## Testing

```typescript
// Test in paper trading mode
const config = { ...productionConfig, paperTrading: true };
const agent = new SafeTradingAgent(config);

// Make test trades
const signal = agent.analyzeTradingOpportunity(...);
const trade = await agent.executeTrade(signal, 150.25);

// Verify behavior
const portfolio = agent.getPortfolioState();
console.assert(portfolio.positions.length <= 5, 'Exceeds max positions');
console.assert(portfolio.totalValue > 0, 'Negative portfolio');
```

## License

Use at your own risk. This agent is designed for educational purposes and personal use. Always test thoroughly before using with real capital.
