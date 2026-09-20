# Deploy Trading Agent to Oracle Cloud (Free Tier)

This guide explains how to deploy the trading agent to Oracle Cloud Always Free tier for 24/7 operation.

## Prerequisites

1. Oracle Cloud Always Free account (free)
2. SSH key pair for Linux VM
3. Your trading API credentials from your broker
4. GitHub personal access token (optional, for auto-deploys)

## Step 1: Create Oracle Cloud VM

### Sign Up
1. Go to https://www.oracle.com/cloud/free/
2. Click "Start for free"
3. Create account (requires credit card for identity verification, but won't charge)
4. Complete verification

### Create Compute Instance
1. Go to Oracle Cloud Console
2. Click "Instances" under "Compute"
3. Click "Create Instance"
4. Configure:
   - **Image**: Ubuntu 22.04 (Always Free eligible)
   - **Shape**: Ampere A1 Compute (4 OCPU, 24GB RAM, always free)
   - **Network**: Default VCN
   - **SSH Key**: Download and save your private key safely
5. Click "Create"
6. Wait 2-3 minutes for instance to start
7. Note the public IP address

### Configure Security

1. Open port 3000 for API access:
   - Go to "Virtual Cloud Networks"
   - Click "Default VCN"
   - Click "Default Security List"
   - Click "Add Ingress Rules"
   - Add: Protocol=TCP, Destination Port=3000, CIDR=0.0.0.0/0
   - Click "Add Ingress Rule"

2. Optional: Create security group for SSH + HTTP + Custom port 3000

## Step 2: SSH into Your VM

```bash
chmod 600 /path/to/your/ssh-key.key
ssh -i /path/to/your/ssh-key.key ubuntu@YOUR_INSTANCE_IP
```

Replace `YOUR_INSTANCE_IP` with the public IP from step 1.

## Step 3: Install Prerequisites

```bash
# Update system
sudo apt update
sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Install Git
sudo apt install -y git

# Create trading user
sudo useradd -m -d /opt/trading-agent trading

# Verify installation
node --version  # Should be v22.x
npm --version
```

## Step 4: Clone and Setup Application

```bash
# Switch to trading user
sudo su - trading

# Clone repository
git clone https://github.com/YOUR_USERNAME/calisthenics-workout.git /opt/trading-agent/app
cd /opt/trading-agent/app

# Install dependencies
npm install --production

# Create logs directory
mkdir -p /opt/trading-agent/logs

# Create .env file from example
cp lib/trading-agent/.env.example /opt/trading-agent/.env
```

## Step 5: Configure Environment

```bash
# Edit configuration
nano /opt/trading-agent/.env
```

Update these critical settings:

```bash
# Your broker API credentials
TRADING_API_KEY=your_api_key_here
TRADING_API_SECRET=your_api_secret_here

# MUST START IN PAPER TRADING MODE
PAPER_TRADING=true

# Risk settings (conservative defaults)
MAX_DAILY_LOSS_PERCENT=2
MAX_POSITION_SIZE_PERCENT=5
MAX_OPEN_POSITIONS=5
MIN_STOP_LOSS_PERCENT=1.5

# Server
PORT=3000
LOG_PATH=/opt/trading-agent/logs/trading-agent.log
```

**CRITICAL**: Always start with `PAPER_TRADING=true`. Test for at least 2 weeks before enabling live trading.

## Step 6: Install Systemd Service

```bash
# Exit trading user if not already
exit

# Copy service file
sudo cp /opt/trading-agent/app/lib/trading-agent/trading-agent.service /etc/systemd/system/

# Update paths in service file if needed
sudo nano /etc/systemd/system/trading-agent.service

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable trading-agent
sudo systemctl start trading-agent

# Check status
sudo systemctl status trading-agent

# View logs
sudo journalctl -u trading-agent -f
```

## Step 7: Verify Deployment

```bash
# Check if service is running
sudo systemctl status trading-agent

# Check logs
sudo journalctl -u trading-agent -n 50

# Check if port 3000 is listening
sudo ss -tlnp | grep 3000

# Test API endpoint
curl http://localhost:3000/health
```

You should see:
```json
{"status":"ok","timestamp":"2024-01-15T10:30:00.000Z","uptime":...}
```

## Step 8: Access Dashboard

Open your browser and go to:
```
http://YOUR_INSTANCE_IP:3000
```

You should see a status dashboard with:
- Portfolio value
- Open positions
- Performance metrics
- Configuration settings

## Step 9: Monitor and Maintain

### Daily Tasks
- Check dashboard at http://YOUR_INSTANCE_IP:3000
- Review logs: `sudo journalctl -u trading-agent -n 100`
- Verify positions are executing correctly
- Check for any error messages

### Weekly Tasks
- Review trading logs: `cat /opt/trading-agent/logs/trading-agent.log | tail -100`
- Analyze performance metrics
- Check if any positions are underwater
- Verify stop-losses are working

### Monthly Tasks
- Review complete trading history
- Calculate actual Sharpe ratio and max drawdown
- Backtest strategy on new data
- Update configuration if needed

## Useful Commands

```bash
# View service logs in real-time
sudo journalctl -u trading-agent -f

# Stop service
sudo systemctl stop trading-agent

# Restart service
sudo systemctl restart trading-agent

# View status
sudo systemctl status trading-agent

# Check disk space
df -h

# Check memory usage
free -h

# Update code
cd /opt/trading-agent/app
git pull origin main
npm install --production
sudo systemctl restart trading-agent

# View trading logs
cat /opt/trading-agent/logs/trading-agent.log | tail -50
```

## Troubleshooting

### Service won't start
```bash
# Check for errors
sudo journalctl -u trading-agent -n 50

# Check if port 3000 is in use
sudo ss -tlnp | grep 3000

# Check file permissions
ls -la /opt/trading-agent/
```

### Can't connect to dashboard
```bash
# Check if port 3000 is open
sudo iptables -L -n | grep 3000

# Check Oracle Cloud security rules
# Go to Console > Instances > Security Lists > Default Security List
# Verify ingress rule for port 3000 exists

# Test locally
curl http://localhost:3000
```

### Out of memory
```bash
# Check memory usage
free -h

# Reduce MemoryLimit in service file
sudo nano /etc/systemd/system/trading-agent.service
# Change: MemoryLimit=512M to MemoryLimit=256M
sudo systemctl daemon-reload
sudo systemctl restart trading-agent
```

### API connection failing
```bash
# Verify credentials
nano /opt/trading-agent/.env
# Ensure TRADING_API_KEY and TRADING_API_SECRET are correct

# Check logs for specific error
sudo journalctl -u trading-agent -n 50 | grep -i "api\|error"
```

## Security Best Practices

1. **Change SSH port** (optional but recommended)
   ```bash
   sudo nano /etc/ssh/sshd_config
   # Change: Port 22 to Port 2222
   sudo systemctl restart sshd
   ```

2. **Use SSH key only** (disable password)
   ```bash
   sudo nano /etc/ssh/sshd_config
   # Set: PasswordAuthentication no
   sudo systemctl restart sshd
   ```

3. **Set up firewall**
   ```bash
   sudo ufw enable
   sudo ufw allow 22
   sudo ufw allow 3000
   ```

4. **Keep secrets secure**
   - Never commit `.env` to git
   - Use file permissions: `chmod 600 /opt/trading-agent/.env`
   - Rotate API keys monthly

5. **Monitor for breaches**
   - Use Oracle Cloud's notification service
   - Set up alerts for unauthorized access
   - Regular security audits

## Going Live (When Ready)

Only after 2+ weeks of successful paper trading:

```bash
# Edit configuration
sudo nano /opt/trading-agent/.env

# Change:
PAPER_TRADING=false

# Save and restart
sudo systemctl restart trading-agent

# Watch logs closely
sudo journalctl -u trading-agent -f
```

**EXTREME CAUTION**: Only enable live trading after:
- [ ] 2+ weeks of profitable paper trading
- [ ] Win rate > 50%
- [ ] All stop-losses working properly
- [ ] You understand the strategy completely
- [ ] You can monitor positions daily
- [ ] You have a kill-switch plan ready

## Cost Analysis

**Oracle Cloud Always Free:**
- Compute Instance: Free (Ampere A1)
- Network: Free (50GB outbound/month)
- Storage: Free (100GB)
- Total: **$0/month**

**When You Exit Free Tier:**
- Ampere A1 Compute: ~$0.02/hour = ~$15/month
- Network egress: ~$0.02/GB = ~$0 (light usage)
- Total: ~$15-20/month

## Support & Monitoring

### Health Checks
The API exposes a health endpoint:
```bash
# Every 5 minutes
curl http://YOUR_INSTANCE_IP:3000/health

# Set up with cron to monitor:
*/5 * * * * curl -f http://localhost:3000/health || (echo "Alert!" | mail -s "Trading Agent Down" your@email.com)
```

### Backup Trading Data
```bash
# Backup logs locally
scp -i your-key.pem ubuntu@YOUR_IP:/opt/trading-agent/logs/* ./backup/

# Schedule daily backup
0 2 * * * scp -i ~/.ssh/trading-key.pem ubuntu@YOUR_IP:/opt/trading-agent/logs/* ~/trading-backups/
```

## Next Steps

1. Deploy to Oracle Cloud (follow steps above)
2. Test in paper trading mode for 2+ weeks
3. Monitor dashboard daily
4. Review logs and metrics
5. Only enable live trading after proven performance
6. Monitor more frequently initially

For questions or issues, check:
- Oracle Cloud documentation
- Trading agent README.md
- Service logs: `sudo journalctl -u trading-agent -f`

Good luck and trade safely! 📈
