# Safe Trading Agent

A scheduled trading agent backed by [Alpaca](https://alpaca.markets). Runs on
GitHub Actions, trades against Alpaca's paper account by default, and enforces
its risk limits against live broker state.

## How it works

Each scheduled run does one cycle and exits:

1. Refuses to proceed unless the account is active and the market is open
2. Reads live equity, cash, buying power and open positions from Alpaca
3. Fetches daily bars for the configured symbols
4. Computes RSI (Wilder) and MACD from those bars
5. Scores each symbol into a buy / sell / hold signal
6. Validates any non-hold signal against the risk limits
7. Submits survivors as **bracket orders**, so the stop-loss sits at the broker

## Why the stop-loss is a bracket order

The agent is not running between scheduled invocations. A stop-loss tracked in
process would only be checked when the agent happens to wake up, so a position
could blow straight through it overnight. Submitting the entry and its stop as a
single bracket order hands the stop to Alpaca, where it stays active whether or
not this code is running.

## Risk limits

All of these are checked against Alpaca's reported account state, not against
locally tracked numbers.

| Limit | Env var | Default | Effect |
|---|---|---|---|
| Daily loss | `MAX_DAILY_LOSS_PERCENT` | 2 | Stops opening positions once the day is down this % of equity |
| Position size | `MAX_POSITION_SIZE_PERCENT` | 5 | Caps any single position at this % of equity |
| Open positions | `MAX_OPEN_POSITIONS` | 5 | Refuses new entries beyond this count |
| Stop-loss | `MIN_STOP_LOSS_PERCENT` | 2 | Distance from entry for the bracket stop |
| Confidence | `MIN_CONFIDENCE` | 0.5 | Ignores signals weaker than this |
| Symbols | `SYMBOLS` | AAPL,MSFT,GOOGL | Allowlist; anything else is refused |

Additional hard rules, not configurable:

- **No shorting.** A sell signal with no existing position is refused, because
  the position-size limits assume bounded downside.
- **No averaging up.** A buy signal for a symbol already held is refused.
- **Sizing is off equity, not buying power.** On a margin account buying power
  exceeds equity; sizing off equity keeps positions within the configured share
  of real capital instead of silently trading on leverage.

## Paper vs live

Paper trading is the default and points at `paper-api.alpaca.markets`, which
uses simulated money. Paper and live accounts have separate API keys.

Going live takes **two** independent signals:

```bash
PAPER_TRADING=false
CONFIRM_LIVE_TRADING=I_UNDERSTAND_THE_RISK
```

Setting only the first makes the agent refuse to start. This is deliberate: one
stray edit to a single secret should not be able to point the agent at real
money.

## Setup

```bash
cp lib/trading-agent/.env.example .env
# fill in ALPACA_API_KEY and ALPACA_API_SECRET from
# https://app.alpaca.markets/paper/dashboard/overview

npm install
npm run trading-agent:test   # verify risk limits and indicator math
npm run trading-agent:run    # one cycle
```

For scheduled runs see [DEPLOY_GITHUB_ACTIONS.md](./DEPLOY_GITHUB_ACTIONS.md).

## Tests

`npm run trading-agent:test` covers the two pieces where a silent bug would be
most expensive:

- **Indicators** — RSI is checked against Wilder's published reference series,
  plus all-gain / all-loss / flat edge cases; MACD is checked for direction and
  for collapsing to zero on flat input. Both must throw on insufficient data
  rather than return a misleading number.
- **Risk limits** — every gate is asserted to block what it should and to allow
  what it should, including the boundary either side of the daily loss limit and
  the margin case where buying power exceeds equity.

The GitHub Actions workflow runs these before trading, so broken risk logic
stops the run rather than reaching the market.

## What this is not

The strategy is a plain RSI + MACD + trend score. It is a reasonable scaffold,
not an edge. It has not been backtested, and the confidence number is a weighted
sum of three indicators, not a probability.

Treat paper trading as the destination until you have your own evidence that the
strategy is worth anything, not as a step on the way to live.

## Files

| File | Purpose |
|---|---|
| `run.ts` | Entry point; one trading cycle |
| `agent.ts` | Orchestration; ties broker, risk and analysis together |
| `alpaca-client.ts` | Alpaca REST client |
| `risk-manager.ts` | Position sizing, stop-loss, all limit checks |
| `market-analyzer.ts` | Signal generation from indicators |
| `indicators.ts` | RSI and MACD |
| `config.ts` | Env loading and the live-trading gate |
| `logger.ts` | JSON audit log |

See [SAFETY.md](./SAFETY.md) before enabling live trading.
