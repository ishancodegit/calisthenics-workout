# Deploy Trading Agent with GitHub Actions

Run your trading agent on a schedule using GitHub Actions. Completely free, no infrastructure to manage.

## Why GitHub Actions?

✅ **Free** - 2,000 minutes/month for private repos, unlimited for public
✅ **No servers** - GitHub manages everything
✅ **Scheduled** - Runs automatically on your schedule
✅ **Logged** - All output saved and viewable
✅ **Simple** - Just commit and it works

## Setup (5 minutes)

### Step 1: Add Secrets

Go to your GitHub repo settings:
1. Click **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add these secrets:

Only the credentials need to be **secrets**:

| Secret | Value |
|---|---|
| `ALPACA_API_KEY` | Paper key from [Alpaca's paper dashboard](https://app.alpaca.markets/paper/dashboard/overview) |
| `ALPACA_API_SECRET` | Paper secret (shown once at generation) |

Everything else is a non-sensitive limit, so set it as a repository **variable**
(Settings → Secrets and variables → Actions → *Variables* tab) where you can
read it back later. All of them have safe defaults, so you can skip this
entirely to start:

| Variable | Default | Meaning |
|---|---|---|
| `PAPER_TRADING` | `true` | `false` points at real money |
| `SYMBOLS` | `AAPL,MSFT,GOOGL` | Allowlist of tickers |
| `MAX_DAILY_LOSS_PERCENT` | `2` | Stop opening positions past this daily loss |
| `MAX_POSITION_SIZE_PERCENT` | `5` | Cap per position, as % of equity |
| `MAX_OPEN_POSITIONS` | `5` | Max concurrent positions |
| `MIN_STOP_LOSS_PERCENT` | `2` | Bracket stop distance from entry |
| `MIN_CONFIDENCE` | `0.5` | Ignore weaker signals |

**Paper keys cannot touch real money.** Alpaca issues separate keys for paper
and live accounts, so a paper key is a hard boundary, not just a flag.

### Step 2: Configure Schedule

Edit `.github/workflows/trading-agent.yml`:

```yaml
on:
  schedule:
    # Choose your schedule (all times UTC)
    
    # Daily at market open (9:30 AM EST = 14:30 UTC)
    - cron: '30 14 * * 1-5'
    
    # Or run twice daily (open + close)
    # - cron: '30 14 * * 1-5'  # 9:30 AM EST
    # - cron: '00 21 * * 1-5'  # 4:00 PM EST
    
    # Or weekly (Mondays at 9:30 AM EST)
    # - cron: '30 14 * * 1'
    
    # Or every 4 hours during market
    # - cron: '0 14,18,22 * * 1-5'
```

**Cron format**: `minute hour day month day-of-week`
- `30 14 * * 1-5` = 14:30 UTC, Monday-Friday
- `0 9 * * *` = 9:00 UTC every day
- `0 */4 * * *` = Every 4 hours

**Convert your timezone**: Use https://crontab.guru/

### Step 3: Commit and Push

```bash
git add .github/workflows/trading-agent.yml
git commit -m "Add trading agent workflow"
git push origin main
```

### Step 4: Test Run

1. Go to **Actions** tab in your repo
2. Click **Trading Agent** workflow
3. Click **Run workflow** → **Run workflow**
4. Watch it execute
5. Check the logs

## Schedule Examples

### Daily Trading (Recommended for Regular Trading)
```yaml
on:
  schedule:
    - cron: '30 14 * * 1-5'  # 9:30 AM EST, weekdays
```

### Twice Daily (Open + Close)
```yaml
on:
  schedule:
    - cron: '30 14 * * 1-5'  # Market open
    - cron: '00 21 * * 1-5'  # Market close
```

### Weekly Review
```yaml
on:
  schedule:
    - cron: '0 14 * * 1'  # Mondays at 9 AM EST
```

### Every 2 Hours During Market
```yaml
on:
  schedule:
    - cron: '0 14,16,18,20 * * 1-5'
```

### Manual Only (No Schedule)
```yaml
on:
  workflow_dispatch:  # Only run when you click
```

## Viewing Results

### In GitHub UI
1. Go to **Actions** tab
2. Click any workflow run
3. See console output
4. Download logs artifact

### Log Files
Each run uploads `logs/` as a downloadable artifact (kept 90 days).

1. Open the workflow run in the **Actions** tab
2. Scroll to **Artifacts**
3. Download `trading-logs-<run-number>`

Logs are deliberately not committed back to the repo — that would add a
commit on every run and needs write permissions the workflow doesn't have.

## Customizing the Agent

Edit `lib/trading-agent/run.ts` to:
- Fetch real market data from your broker
- Analyze multiple symbols
- Execute trades based on signals
- Monitor positions
- Send notifications

Example:
```typescript
// Fetch real data
const prices = await fetchPrices('AAPL');
const volumes = await fetchVolumes('AAPL');

// Analyze
const signal = agent.analyzeTradingOpportunity('AAPL', prices, volumes, rsi, macd);

// Execute if strong
if (signal.confidence > 0.6) {
  const trade = await agent.executeTrade(signal, currentPrice);
  console.log('Trade executed:', trade);
}
```

## Cost

**GitHub Actions Free Tier:**
- Public repos: **Unlimited** minutes
- Private repos: **2,000 minutes/month** free

**Typical usage:**
- Daily run (1 min each): ~30 min/month
- Twice daily: ~60 min/month
- Hourly: ~720 min/month

**You're well within free limits!**

## Monitoring

### Email Notifications
GitHub sends emails on workflow failures by default.

### Add Slack Notification
```yaml
- name: Notify Slack
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    payload: |
      {"text": "Trading agent failed!"}
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

### Add Discord Notification
```yaml
- name: Notify Discord
  if: always()
  run: |
    curl -X POST ${{ secrets.DISCORD_WEBHOOK }} \
      -H "Content-Type: application/json" \
      -d '{"content":"Trading run completed"}'
```

## Troubleshooting

### Workflow not running
- Check cron syntax at https://crontab.guru/
- Verify workflow file is in `.github/workflows/`
- Check Actions tab for errors
- Ensure repo has Actions enabled

### Credentials not set
```
Trading cycle failed: ALPACA_API_KEY and ALPACA_API_SECRET must be set
```
Fix: add both under Settings → Secrets and variables → Actions → *Secrets*.

### 401 from Alpaca
```
Trading cycle failed: Alpaca GET /v2/clock failed: 401
```
The keys are wrong or are live keys used against the paper endpoint (the two
are not interchangeable). Regenerate from the paper dashboard.

### Run says "Not trading: Market closed"
Expected outside US market hours. Cron is UTC and does not follow daylight
saving, so a schedule that lands inside the session in winter can fall outside
it in summer. See the comment at the top of the workflow.

### Build fails
```bash
# Reproduce locally
npm ci
npm run trading-agent:test
npm run trading-agent:run
```

## Security Best Practices

1. **Never commit secrets**
   - Use GitHub Secrets only
   - Add `.env` to `.gitignore`

2. **Limit permissions**
   ```yaml
   permissions:
     contents: read  # Minimal access
   ```

3. **Use environment protection**
   - Settings → Environments → New environment
   - Add required reviewers for production

4. **Rotate keys regularly**
   - Update secrets monthly
   - Use read-only keys when possible

5. **Monitor runs**
   - Check Actions tab weekly
   - Review all trades in logs

## Going live

Going live needs two independent settings, not one:

1. Repository **variable** `PAPER_TRADING` = `false`
2. Repository **secret** `CONFIRM_LIVE_TRADING` = `I_UNDERSTAND_THE_RISK`
3. Replace `ALPACA_API_KEY` / `ALPACA_API_SECRET` with **live** account keys

Setting only the first makes the agent refuse to start, by design.

Before you do any of that, be honest about the evidence you actually have:

- [ ] Months, not weeks, of paper results — a two-week sample cannot separate a
      working strategy from a lucky one
- [ ] Results compared against simply holding the same symbols; if buy-and-hold
      wins, the agent is subtracting value
- [ ] You have read `run.ts` and `market-analyzer.ts` and can explain why each
      signal fires
- [ ] Stop-losses observed actually filling on Alpaca, not merely submitted
- [ ] A loss you would accept without changing anything, decided in advance
- [ ] Money you can lose entirely without it mattering

The strategy here is a plain RSI + MACD + trend score. It has not been
backtested and carries no demonstrated edge. Paper trading is a fine permanent
home for it.

## Advanced: Multiple Strategies

Run different strategies on different schedules:

```yaml
# .github/workflows/trading-conservative.yml
on:
  schedule:
    - cron: '30 14 * * 1-5'
env:
  MAX_POSITION_SIZE_PERCENT: 3
  MIN_STOP_LOSS_PERCENT: 2

# .github/workflows/trading-aggressive.yml  
on:
  schedule:
    - cron: '0 15 * * 1-5'
env:
  MAX_POSITION_SIZE_PERCENT: 8
  MIN_STOP_LOSS_PERCENT: 1
```

## Next Steps

1. ✅ Add secrets to GitHub
2. ✅ Configure schedule
3. ✅ Push workflow file
4. ✅ Run manually to test
5. ✅ Monitor for 2 weeks in paper mode
6. ⏳ Review results
7. ⏳ Go live if profitable

Your agent will now run automatically on schedule! 📈
