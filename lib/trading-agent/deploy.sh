#!/bin/bash

# Trading Agent Deployment Script for Oracle Cloud
# Usage: sudo ./deploy.sh

set -e

echo "🚀 Trading Agent Deployment Script"
echo "===================================="
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root (use: sudo ./deploy.sh)"
   exit 1
fi

# Variables
APP_DIR="/opt/trading-agent/app"
LOG_DIR="/opt/trading-agent/logs"
TRADING_USER="trading"

echo "📦 Step 1: Installing system dependencies..."
apt update -qq
apt install -y curl git nodejs npm > /dev/null 2>&1
echo "✓ System dependencies installed"

echo ""
echo "👤 Step 2: Creating trading user..."
if ! id "$TRADING_USER" &>/dev/null; then
    useradd -m -d /opt/trading-agent "$TRADING_USER"
    echo "✓ Trading user created"
else
    echo "✓ Trading user already exists"
fi

echo ""
echo "📂 Step 3: Setting up application directory..."
mkdir -p "$LOG_DIR"
chown -R "$TRADING_USER:$TRADING_USER" /opt/trading-agent
chmod 755 "$LOG_DIR"
echo "✓ Application directory setup complete"

echo ""
echo "📦 Step 4: Installing Node.js dependencies..."
cd "$APP_DIR"
sudo -u "$TRADING_USER" npm install --production > /dev/null 2>&1
echo "✓ Dependencies installed"

echo ""
echo "⚙️  Step 5: Setting up systemd service..."
cp "$APP_DIR/lib/trading-agent/trading-agent.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable trading-agent
echo "✓ Systemd service configured"

echo ""
echo "🔧 Step 6: Configuring environment..."
if [ ! -f "/opt/trading-agent/.env" ]; then
    cp "$APP_DIR/lib/trading-agent/.env.example" /opt/trading-agent/.env
    chown "$TRADING_USER:$TRADING_USER" /opt/trading-agent/.env
    chmod 600 /opt/trading-agent/.env
    echo "✓ Environment file created (you must edit /opt/trading-agent/.env)"
else
    echo "✓ Environment file already exists"
fi

echo ""
echo "✨ Deployment complete!"
echo ""
echo "📝 Next steps:"
echo "1. Edit configuration: nano /opt/trading-agent/.env"
echo "   - Set TRADING_API_KEY and TRADING_API_SECRET"
echo "   - Ensure PAPER_TRADING=true (test first!)"
echo ""
echo "2. Start the service:"
echo "   sudo systemctl start trading-agent"
echo ""
echo "3. Check status:"
echo "   sudo systemctl status trading-agent"
echo ""
echo "4. View logs:"
echo "   sudo journalctl -u trading-agent -f"
echo ""
echo "5. Access dashboard:"
echo "   http://YOUR_INSTANCE_IP:3000"
echo ""
echo "📚 Full guide: cat $APP_DIR/lib/trading-agent/DEPLOY_ORACLE_CLOUD.md"
echo ""
