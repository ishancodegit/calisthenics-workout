import * as http from 'http';
import { SafeTradingAgent, TradingConfig } from './index';

const PORT = process.env.PORT || 3000;
const PAPER_TRADING = process.env.PAPER_TRADING !== 'false';
const LOG_PATH = process.env.LOG_PATH || './logs/trading-agent.log';

// Load configuration from environment
const config: TradingConfig = {
  apiKey: process.env.TRADING_API_KEY || '',
  apiSecret: process.env.TRADING_API_SECRET || '',
  paperTrading: PAPER_TRADING,
  maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '2'),
  maxPositionSizePercent: parseFloat(process.env.MAX_POSITION_SIZE_PERCENT || '5'),
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '5'),
  minStopLossPercent: parseFloat(process.env.MIN_STOP_LOSS_PERCENT || '1.5'),
  enableAutoStopLoss: process.env.ENABLE_AUTO_STOP_LOSS !== 'false',
  enableRiskManagement: process.env.ENABLE_RISK_MANAGEMENT !== 'false',
  maxLeverage: parseFloat(process.env.MAX_LEVERAGE || '1'),
  allowedSymbols: process.env.ALLOWED_SYMBOLS
    ? process.env.ALLOWED_SYMBOLS.split(',')
    : undefined,
};

let agent: SafeTradingAgent;
let lastHealthCheck = new Date();

// Initialize agent
function initializeAgent() {
  try {
    if (!config.apiKey || !config.apiSecret) {
      console.warn('⚠️  API credentials not set. Running in monitoring mode only.');
    }

    agent = new SafeTradingAgent(config, LOG_PATH);
    console.log('✓ Trading agent initialized');
    console.log(`  Mode: ${config.paperTrading ? 'PAPER' : 'LIVE'}`);
    console.log(`  Max Daily Loss: ${config.maxDailyLossPercent}%`);
    console.log(`  Max Position Size: ${config.maxPositionSizePercent}%`);
    console.log(`  Max Open Positions: ${config.maxOpenPositions}`);
  } catch (error) {
    console.error('Failed to initialize agent:', error);
    process.exit(1);
  }
}

// HTTP Server
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Health check
  if (pathname === '/health') {
    lastHealthCheck = new Date();
    res.writeHead(200);
    res.end(
      JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mode: config.paperTrading ? 'paper' : 'live',
      })
    );
    return;
  }

  // Portfolio status
  if (pathname === '/api/portfolio') {
    try {
      const portfolio = agent.getPortfolioState();
      res.writeHead(200);
      res.end(JSON.stringify(portfolio));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(error) }));
    }
    return;
  }

  // Metrics
  if (pathname === '/api/metrics') {
    try {
      const metrics = agent.getMetrics();
      res.writeHead(200);
      res.end(JSON.stringify(metrics));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(error) }));
    }
    return;
  }

  // Config status
  if (pathname === '/api/config') {
    const sanitized = { ...config };
    delete (sanitized as any).apiKey;
    delete (sanitized as any).apiSecret;
    res.writeHead(200);
    res.end(JSON.stringify(sanitized));
    return;
  }

  // Status page
  if (pathname === '/' || pathname === '/status') {
    try {
      const portfolio = agent.getPortfolioState();
      const metrics = agent.getMetrics();

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Trading Agent Status</title>
          <style>
            body { font-family: monospace; margin: 20px; background: #1e1e1e; color: #d4d4d4; }
            h1 { color: #4ec9b0; }
            .status { padding: 10px; background: #252526; border-radius: 4px; margin: 10px 0; }
            .ok { border-left: 4px solid #4ec9b0; }
            .warning { border-left: 4px solid #ce9178; }
            .error { border-left: 4px solid #f48771; }
            .metric { display: inline-block; margin: 10px 20px 10px 0; }
            .value { color: #4ec9b0; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>🤖 Trading Agent Status</h1>

          <div class="status ok">
            <strong>Mode:</strong> <span class="value">${config.paperTrading ? 'PAPER TRADING' : 'LIVE TRADING'}</span>
            <br>
            <strong>Uptime:</strong> <span class="value">${Math.floor(process.uptime())}s</span>
            <br>
            <strong>Last Health Check:</strong> <span class="value">${lastHealthCheck.toISOString()}</span>
          </div>

          <div class="status ${portfolio.positions.length > 0 ? 'ok' : 'warning'}">
            <h3>Portfolio</h3>
            <div class="metric">Total Value: <span class="value">$${portfolio.totalValue.toFixed(2)}</span></div>
            <div class="metric">Cash: <span class="value">$${portfolio.cash.toFixed(2)}</span></div>
            <div class="metric">Open Positions: <span class="value">${portfolio.positions.length}/${config.maxOpenPositions}</span></div>
            <div class="metric">Daily PnL: <span class="value">$${portfolio.dailyPnL.toFixed(2)}</span></div>
            <div class="metric">Win Rate: <span class="value">${portfolio.winRate.toFixed(1)}%</span></div>
          </div>

          <div class="status ok">
            <h3>Performance Metrics</h3>
            <div class="metric">Sharpe Ratio: <span class="value">${metrics.sharpeRatio.toFixed(3)}</span></div>
            <div class="metric">Max Drawdown: <span class="value">${metrics.maxDrawdown.toFixed(2)}%</span></div>
            <div class="metric">Total PnL: <span class="value">$${metrics.totalPnL.toFixed(2)}</span></div>
            <div class="metric">Risk/Reward: <span class="value">${metrics.averageRiskReward.toFixed(2)}</span></div>
          </div>

          <div class="status ok">
            <h3>Configuration</h3>
            <div class="metric">Max Daily Loss: <span class="value">${config.maxDailyLossPercent}%</span></div>
            <div class="metric">Max Position Size: <span class="value">${config.maxPositionSizePercent}%</span></div>
            <div class="metric">Min Stop Loss: <span class="value">${config.minStopLossPercent}%</span></div>
            <div class="metric">Max Leverage: <span class="value">${config.maxLeverage}x</span></div>
          </div>

          <hr>
          <p><small>Last updated: ${new Date().toISOString()}</small></p>
          <p><small>API endpoints: /api/portfolio, /api/metrics, /api/config, /health</small></p>
        </body>
        </html>
      `;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(error) }));
    }
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// Start server
server.listen(PORT, () => {
  console.log(`\n🚀 Trading Agent Server started on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`❤️  Health: http://localhost:${PORT}/health`);
  console.log(`📈 API: http://localhost:${PORT}/api/portfolio`);
  console.log('');
  console.log('Press Ctrl+C to stop\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Initialize on startup
initializeAgent();
