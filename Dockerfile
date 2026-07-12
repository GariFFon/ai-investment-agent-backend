# ── Build Stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base

# Set working directory
WORKDIR /app

# Copy package files first (for better layer caching)
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# ── Production Stage ───────────────────────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Copy installed node_modules from base stage
COPY --from=base /app/node_modules ./node_modules

# Copy application source
COPY src/ ./src/
COPY package.json ./

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose the port the app listens on
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

# Start the application
CMD ["node", "src/index.js"]
