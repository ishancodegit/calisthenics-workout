const PAPER_TRADING_URL = 'https://paper-api.alpaca.markets';
const LIVE_TRADING_URL = 'https://api.alpaca.markets';
const MARKET_DATA_URL = 'https://data.alpaca.markets';

export interface AlpacaAccount {
  cash: number;
  equity: number;
  /** Equity at the previous trading day's close; the basis for daily P&L. */
  lastEquity: number;
  buyingPower: number;
  status: string;
  tradingBlocked: boolean;
  accountBlocked: boolean;
  tradeSuspendedByUser: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
  side: 'long' | 'short';
}

export interface Bar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketClock {
  isOpen: boolean;
  nextOpen: string;
  nextClose: string;
}

export interface BracketOrderRequest {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  stopLossPrice: number;
  takeProfitPrice?: number;
}

export interface AlpacaOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  qty: number;
  side: string;
  type: string;
  status: string;
  submittedAt: string;
}

export class AlpacaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string
  ) {
    super(message);
    this.name = 'AlpacaError';
  }
}

export class AlpacaClient {
  private readonly tradingUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly paperTrading: boolean
  ) {
    if (!apiKey || !apiSecret) {
      throw new Error('Alpaca API key and secret are required');
    }
    this.tradingUrl = paperTrading ? PAPER_TRADING_URL : LIVE_TRADING_URL;
  }

  isPaperTrading(): boolean {
    return this.paperTrading;
  }

  async getAccount(): Promise<AlpacaAccount> {
    const data = await this.request(this.tradingUrl, '/v2/account');
    return {
      cash: parseFloat(data.cash),
      equity: parseFloat(data.equity),
      lastEquity: parseFloat(data.last_equity),
      buyingPower: parseFloat(data.buying_power),
      status: data.status,
      tradingBlocked: data.trading_blocked,
      accountBlocked: data.account_blocked,
      tradeSuspendedByUser: data.trade_suspended_by_user,
    };
  }

  async getPositions(): Promise<AlpacaPosition[]> {
    const data = await this.request(this.tradingUrl, '/v2/positions');
    return data.map((p: any) => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      avgEntryPrice: parseFloat(p.avg_entry_price),
      currentPrice: parseFloat(p.current_price),
      marketValue: parseFloat(p.market_value),
      unrealizedPl: parseFloat(p.unrealized_pl),
      side: p.side,
    }));
  }

  async getClock(): Promise<MarketClock> {
    const data = await this.request(this.tradingUrl, '/v2/clock');
    return {
      isOpen: data.is_open,
      nextOpen: data.next_open,
      nextClose: data.next_close,
    };
  }

  async getBars(symbols: string[], timeframe: string, limit: number): Promise<Map<string, Bar[]>> {
    const params = new URLSearchParams({
      symbols: symbols.join(','),
      timeframe,
      limit: String(limit),
      feed: 'iex',
      adjustment: 'split',
      sort: 'asc',
    });

    const data = await this.request(MARKET_DATA_URL, `/v2/stocks/bars?${params}`);
    const result = new Map<string, Bar[]>();

    for (const [symbol, bars] of Object.entries(data.bars ?? {})) {
      result.set(
        symbol,
        (bars as any[]).map(b => ({
          timestamp: b.t,
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v,
        }))
      );
    }

    return result;
  }

  /**
   * Submits the entry and its stop-loss as one bracket order so the stop lives
   * at the broker. A scheduled agent is not running most of the time; an
   * in-process stop would not fire between runs.
   */
  async submitBracketOrder(order: BracketOrderRequest): Promise<AlpacaOrder> {
    const body: Record<string, unknown> = {
      symbol: order.symbol,
      qty: String(order.qty),
      side: order.side,
      type: 'market',
      time_in_force: 'gtc',
      order_class: 'bracket',
      stop_loss: { stop_price: order.stopLossPrice.toFixed(2) },
    };

    if (order.takeProfitPrice !== undefined) {
      body.take_profit = { limit_price: order.takeProfitPrice.toFixed(2) };
    }

    const data = await this.request(this.tradingUrl, '/v2/orders', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      id: data.id,
      clientOrderId: data.client_order_id,
      symbol: data.symbol,
      qty: parseFloat(data.qty),
      side: data.side,
      type: data.type,
      status: data.status,
      submittedAt: data.submitted_at,
    };
  }

  private async request(baseUrl: string, path: string, init: RequestInit = {}): Promise<any> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'APCA-API-KEY-ID': this.apiKey,
        'APCA-API-SECRET-KEY': this.apiSecret,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      // Never include headers in the message; they carry the API secret.
      throw new AlpacaError(
        `Alpaca ${init.method ?? 'GET'} ${path} failed: ${response.status}`,
        response.status,
        text.slice(0, 500)
      );
    }

    return text ? JSON.parse(text) : null;
  }
}
