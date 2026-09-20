FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create logs directory
RUN mkdir -p /app/logs

# Expose port for health checks
EXPOSE 3000

# Run trading agent
CMD ["node", "--loader", "ts-node/esm", "lib/trading-agent/server.ts"]
