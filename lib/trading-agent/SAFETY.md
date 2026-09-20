# Safety Guidelines for Trading Agent

## WARNING: High Risk Activity

Algorithmic trading involves significant financial risk. This agent is designed with multiple safeguards, but **losses are possible** and you could lose your entire investment. Only trade with capital you can afford to lose.

## Critical Safety Rules

### 1. Never Use Real Money Without Testing

- Always start with paper trading (`paperTrading: true`)
- Test for at least 2 weeks in paper mode
- Review all logs and metrics before going live
- Start with minimal capital if you go live
- Never trade entire portfolio on first day

### 2. API Key Security

```typescript
// CORRECT: Use environment variables
const apiKey = process.env.ALPACA_API_KEY;

// WRONG: Never hardcode keys
const apiKey = 'sk_live_abc123...';
```

- Rotate API keys monthly
- Use read-only API keys for testing
- Set IP whitelist on API
- Never commit `.env` files to git
- Use `.gitignore` for sensitive files

### 3. Risk Limits (Recommended Defaults)

```typescript
// Conservative starting configuration
{
  maxDailyLossPercent: 2,      // Stop after 2% loss
  maxPositionSizePercent: 3,   // Max 3% per trade
  maxOpenPositions: 3,         // Max 3 concurrent trades
  minStopLossPercent: 2,       // Minimum 2% stop-loss
  maxLeverage: 1,              // No leverage
  enableRiskManagement: true,
  enableAutoStopLoss: true,
}
```

**Why these limits?**
- 2% daily loss = natural stop point
- 3% position size = survive 33 losses in a row
- 3 positions = diversified but manageable
- 2% stop-loss = avoid whipsaw while protecting capital
- 1x leverage = no forced liquidation

### 4. Operational Safety

1. **Monitor in Real-time**
   - Check logs every hour during trading
   - Review portfolio state before lunch
   - Set phone alerts for major changes
   - Have manual kill-switch ready

2. **Daily Checklist**
   - [ ] Verify API connections working
   - [ ] Check market hours
   - [ ] Review previous day logs
   - [ ] Confirm stop-loss orders in place
   - [ ] Monitor first 30 minutes of trading
   - [ ] Review end-of-day metrics

3. **Weekly Review**
   - [ ] Analyze win rate and average trade
   - [ ] Check for unexpected patterns
   - [ ] Review all rejected trades
   - [ ] Validate risk limits still appropriate
   - [ ] Backup trading logs

4. **Monthly Review**
   - [ ] Audit complete trading history
   - [ ] Calculate Sharpe ratio and drawdown
   - [ ] Identify losing patterns
   - [ ] Consider adjusting parameters
   - [ ] Verify no code changes since deployment

### 5. Disaster Recovery

Keep these controls ready:

```typescript
// Kill switch: stops all trading immediately
agent.disableTrading = true;

// Emergency: Close all positions
await agent.liquidateAllPositions();

// Safe: Switch to paper mode
config.paperTrading = true;
```

### 6. Common Mistakes to Avoid

❌ **WRONG:**
- Trading on margin/leverage
- Ignoring stop-loss orders
- Trading illiquid symbols
- Overriding risk checks
- Trading 24/7 (gaps/slippage)
- Using live credentials in tests
- Hardcoding position sizes
- Trading while market is closed
- Ignoring logs and alerts

✅ **RIGHT:**
- Start with paper trading
- Honor all risk limits
- Trade liquid symbols only
- Follow configured constraints
- Trade during market hours
- Use environment variables
- Calculate positions dynamically
- Check market hours before trading
- Review logs daily

### 7. Market Conditions

**DO NOT TRADE IF:**
- Volatility is extremely high (VIX > 30)
- Market just opened (high slippage)
- Major economic news announced
- You can't monitor the positions
- Daily loss limit already hit
- Illiquid market conditions
- Technical indicators are conflicting

**Trade with caution if:**
- Volume is below average
- Bid-ask spread is wide
- Earnings report coming
- Federal Reserve meeting
- Market near close (4pm EST)

### 8. Testing Checklist Before Going Live

Required tests before using real money:

- [ ] Paper trading for 2+ weeks
- [ ] All trades logged correctly
- [ ] Stop-loss orders triggered properly
- [ ] Daily loss limit enforced
- [ ] Position size limits working
- [ ] No hardcoded API keys
- [ ] Error handling tested
- [ ] Network failure recovery tested
- [ ] Logs are readable and complete
- [ ] Metrics accurately calculated
- [ ] Max open positions enforced
- [ ] Unfavorable market conditions rejected
- [ ] Can manually kill trading instantly
- [ ] Backup contact info configured
- [ ] Understands all parameters

### 9. Red Flags - Stop Trading If:

1. **Agent behavior changes unexpectedly**
   - Taking different position sizes
   - Ignoring stop-loss orders
   - Not respecting position limits

2. **Market is disconnected**
   - No price updates
   - Trades failing
   - Latency spike

3. **You can't monitor**
   - Losing internet connection
   - Need to leave without supervision
   - Alerts not working

4. **Performance is bad**
   - Win rate below 30%
   - Large consecutive losses
   - Sharpe ratio < 0.5

5. **System is unstable**
   - Logs showing errors
   - Memory usage growing
   - CPU at 100%

### 10. Capital Allocation Strategy

Example for $10,000 account:

```
Starting Capital: $10,000
Max Daily Loss: 2% = $200
Max Position Size: 3% = $300
Max Open Positions: 3

Max Loss Per Position: $200 / 3 = $67
With 2% stop-loss: Can trade ~3,300 shares @ $100
```

Start with even smaller position sizes to learn:
- Day 1-5: Trade 1% position size
- Week 1-2: Trade 2% position size
- Week 3-4: Trade 3% position size only after profits
- Month 2+: Scale if comfortable and profitable

### 11. Logging & Auditing

Everything is logged:
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Trade executed",
  "data": {
    "symbol": "AAPL",
    "type": "buy",
    "quantity": 10,
    "price": 150.25
  }
}
```

Review logs for:
- Unexpected trade patterns
- Risk limit violations
- API errors
- Position tracking discrepancies

### 12. Legal & Tax Considerations

- Consult a tax professional (trading is taxable)
- Day trading has pattern day trader rules (USA)
- Different jurisdictions have different rules
- Keep records for 7+ years
- Report all income to authorities
- Consider professional liability insurance

### 13. Emergency Contacts

Keep this accessible:
```
Broker Support: [number]
Account Manager: [number]
Technical Support: [number]
Your Email: [email]
Backup Contact: [person/number]
```

### 14. Final Safety Principle

**Doubt = Don't Trade**

If anything feels wrong:
- Stop all trading
- Review logs
- Verify assumptions
- Get second opinion
- Only resume when confident

The market will be there tomorrow. Capital preservation is more important than maximum profits.

## Acknowledgment

By using this trading agent, you acknowledge:
- You understand the risks
- You accept full responsibility for losses
- You will follow all safety guidelines
- You will not trade with capital you can't afford to lose
- You will monitor positions actively
- You will use environment variables for credentials
- You will test thoroughly before going live

**This agent is for educational purposes. Trade at your own risk.**
