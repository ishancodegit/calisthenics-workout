import { SafeTradingAgent } from './agent';
import { AlpacaClient } from './alpaca-client';
import { Logger } from './logger';
import { loadConfig } from './config';

const LOG_PATH = process.env.LOG_PATH ?? './logs/trading-agent.log';
const BARS_TO_FETCH = 120;

async function main(): Promise<number> {
  const config = loadConfig();
  const logger = new Logger(LOG_PATH);
  const broker = new AlpacaClient(config.apiKey, config.apiSecret, config.paperTrading);
  const agent = new SafeTradingAgent(config, broker, logger);

  console.log('='.repeat(64));
  console.log(`Trading Agent  |  ${config.paperTrading ? 'PAPER' : 'LIVE'}  |  ${new Date().toISOString()}`);
  console.log('='.repeat(64));

  const permission = await agent.checkTradingAllowed();
  if (!permission.allowed) {
    console.log(`\nNot trading: ${permission.reason}`);
    logger.info('Trading skipped', { reason: permission.reason });
    return 0;
  }

  const portfolio = await agent.getPortfolioState();
  console.log('\nAccount');
  console.log(`  Equity:        $${portfolio.equity.toFixed(2)}`);
  console.log(`  Cash:          $${portfolio.cash.toFixed(2)}`);
  console.log(`  Buying power:  $${portfolio.buyingPower.toFixed(2)}`);
  console.log(`  Day P&L:       $${portfolio.dailyPnL.toFixed(2)}`);
  console.log(`  Unrealized:    $${portfolio.unrealizedPnL.toFixed(2)}`);
  console.log(`  Positions:     ${portfolio.positions.length}/${config.maxOpenPositions}`);

  for (const p of portfolio.positions) {
    console.log(
      `    ${p.symbol.padEnd(6)} ${String(p.quantity).padStart(5)} @ $${p.entryPrice.toFixed(2)}` +
        `  now $${p.currentPrice.toFixed(2)}  P&L $${p.unrealizedPnL.toFixed(2)}`
    );
  }

  const bars = await broker.getBars(config.symbols, '1Day', BARS_TO_FETCH);

  console.log('\nSignals');
  let submitted = 0;

  for (const symbol of config.symbols) {
    const symbolBars = bars.get(symbol);

    if (!symbolBars?.length) {
      console.log(`  ${symbol.padEnd(6)} no market data returned`);
      logger.warn(`No bars for ${symbol}`);
      continue;
    }

    const closes = symbolBars.map(b => b.close);
    const volumes = symbolBars.map(b => b.volume);
    const lastPrice = closes[closes.length - 1];

    const signal = agent.analyzeSymbol(symbol, closes, volumes);
    console.log(
      `  ${symbol.padEnd(6)} ${signal.action.toUpperCase().padEnd(5)} ` +
        `conf ${(signal.confidence * 100).toFixed(0).padStart(3)}%  ` +
        `risk ${signal.riskLevel.padEnd(6)}  ${signal.reason}`
    );

    const decision = await agent.executeSignal(signal, lastPrice, portfolio);

    if (decision.executed) {
      submitted++;
      console.log(`         -> order ${decision.order!.id} (${decision.order!.status})`);
    } else if (signal.action !== 'hold') {
      console.log(`         -> skipped: ${decision.rejectedReason}`);
    }
  }

  console.log(`\n${submitted} order(s) submitted. Logs: ${LOG_PATH}`);
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch((error: unknown) => {
    // Credentials live in this process; print only the message, never the error
    // object, which can carry request context.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nTrading cycle failed: ${message}`);
    process.exit(1);
  });
