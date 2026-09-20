# Quick Start: Deploy Trading Agent to Oracle Cloud

## 5-Minute Setup

### 1. Create Oracle Cloud VM
- Go to https://www.oracle.com/cloud/free/
- Sign up (free, no charges)
- Create Ubuntu 22.04 Ampere A1 instance
- Download SSH key
- Wait for instance to start
- Note the public IP

### 2. SSH into VM
```bash
chmod 600 ~/Downloads/your-ssh-key.key
ssh -i ~/Downloads/your-ssh-key.key ubuntu@YOUR_IP
```

### 3. Run Deployment
```bash
# Download and run deploy script
curl -sSL https://raw.githubusercontent.com/YOUR_REPO/main/lib/trading-agent/deploy.sh | sudo bash
```

Or manually:
```bash
sudo apt update && sudo apt install -y git nodejs npm
git clone https://github.com/YOUR_REPO.git /opt/trading-agent/app
cd /opt/trading-agent/app
sudo npm install
sudo cp lib/trading-agent/trading-agent.service /etc/systemd/system/
sudo cp lib/trading-agent/.env.example /opt/trading-agent/.env
```

### 4. Configure Trading
```bash
sudo nano /opt/trading-agent/.env
```

Edit these values:
```
TRADING_API_KEY=your_broker_key
TRADING_API_SECRET=your_broker_secret
PAPER_TRADING=true  # Keep TRUE for testing!
```

### 5. Start Service
```bash
sudo systemctl start trading-agent
sudo systemctl status trading-agent
```

### 6. Access Dashboard
Open browser: `http://YOUR_IP:3000`

You're done! The agent is running 24/7 on Oracle Cloud for free.

## Important: Testing First

⚠️ **ALWAYS** keep `PAPER_TRADING=true` initially!

Test for 2 weeks:
1. Monitor dashboard daily
2. Check logs: `sudo journalctl -u trading-agent -f`
3. Verify trades execute (in paper mode)
4. Review performance metrics

Only after 2+ weeks of success, edit `.env` and change `PAPER_TRADING=false`

## Useful Commands

```bash
# Check status
sudo systemctl status trading-agent

# View logs
sudo journalctl -u trading-agent -f

# Stop
sudo systemctl stop trading-agent

# Restart
sudo systemctl restart trading-agent

# Edit config
sudo nano /opt/trading-agent/.env

# Restart after config change
sudo systemctl restart trading-agent
```

## Monitoring

The dashboard shows:
- Portfolio value and positions
- Daily P&L
- Win rate
- Sharpe ratio and max drawdown
- All configuration settings

API endpoints:
- `/health` - Health check
- `/api/portfolio` - Portfolio JSON
- `/api/metrics` - Performance metrics
- `/` - Full dashboard

## Full Guide

For detailed information, see `DEPLOY_ORACLE_CLOUD.md`

## Key Safety Rules

1. ✅ Start with paper trading
2. ✅ Test for 2+ weeks minimum
3. ✅ Never hardcode API keys
4. ✅ Monitor daily
5. ✅ Have kill-switch ready
6. ✅ Keep position sizes small (3-5% max)
7. ✅ Set daily loss limits (1-2% max)
8. ❌ Don't trade illiquid symbols
9. ❌ Don't trade with leverage
10. ❌ Don't override risk limits

## Troubleshooting

### Service won't start
```bash
sudo journalctl -u trading-agent -n 50
```

### Can't access dashboard
1. Check Oracle Cloud security rules (port 3000 open?)
2. Verify service is running: `sudo systemctl status trading-agent`
3. Test locally: `curl http://localhost:3000`

### API connection failing
```bash
# Check credentials in .env
sudo cat /opt/trading-agent/.env | grep TRADING

# Check error logs
sudo journalctl -u trading-agent -n 100 | grep -i error
```

## Cost

Oracle Cloud Always Free tier:
- VM: $0/month
- Network: $0/month  
- Storage: $0/month
- **Total: Free forever** (until you upgrade)

## Next Steps

1. Create Oracle Cloud account
2. Launch VM instance
3. Run deployment script
4. Configure API credentials
5. Test for 2 weeks
6. Monitor daily

Questions? Check `DEPLOY_ORACLE_CLOUD.md` for detailed guide.

**Trade safely! 📈**
