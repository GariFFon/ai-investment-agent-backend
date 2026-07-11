# InvestIQ — AI Investment Research Agent

> Built for the InsideIIM × Altuni AI Labs internship assignment.

## Overview

InvestIQ is an AI-powered investment research agent that takes a company name, autonomously gathers financial data from multiple sources, and produces a structured **Invest / Hold / Pass** verdict with full reasoning.

**How it works in one sentence:** You type "Apple" → an AI agent fetches 8 categories of financial data → Gemini synthesizes it → you get a professional investment analysis in seconds.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React (Vite) |
| Backend | Node.js + Express |
| AI Agent | LangGraph.js + LangChain.js |
| LLM | Google Gemini 1.5 Flash |
| Data | Financial Modeling Prep API |
| Database | MongoDB Atlas (with 24h TTL cache) |

---

## How to Run

### Prerequisites
- Node.js 18+
- MongoDB Atlas account (free tier)
- API keys (see below)

### 1. Get API Keys

| Key | Where to get |
|-----|-------------|
| `FMP_API_KEY` | https://financialmodelingprep.com (free) |
| `GEMINI_API_KEY` | https://aistudio.google.com (free) |
| `MONGODB_URI` | https://cloud.mongodb.com (free 512MB cluster) |

### 2. Setup Server

```bash
cd server
cp .env.example .env
# Fill in your API keys in .env
npm install
npm run dev
```

### 3. Setup Client

```bash
cd client
cp .env.example .env
# .env already points to http://localhost:5000
npm install
npm run dev
```

### 4. Open Browser
```
http://localhost:5173
```

---

## How It Works

### Architecture

```
React Frontend
    ↓ POST /api/analyze
Express Backend
    ↓ check MongoDB cache (24h TTL)
    ↓ if miss → run LangGraph agent
LangGraph ReAct Agent
    ↓ calls 8 FMP tools in sequence
    ↓ Gemini synthesizes all data
    ↓ returns structured JSON verdict
MongoDB saves result
    ↓ returns to frontend
```

### Agent Flow (LangGraph ReAct)

1. `search_company` → resolve name to ticker
2. `get_company_profile` → business, sector, CEO
3. `get_income_statement` → 3yr revenue/margins
4. `get_balance_sheet` → debt, assets, cash
5. `get_cash_flow` → FCF, capex
6. `get_key_metrics` → P/E, ROE, EV/EBITDA
7. `get_company_news` → recent developments
8. `get_peers` → competitor landscape
9. **Gemini synthesizes** → `INVEST / HOLD / PASS` + full reasoning

### Caching Strategy

- On first search: fetches from FMP API, runs AI analysis, saves to MongoDB
- On repeat search (< 24h): returns cached result instantly (0 API calls)
- MongoDB TTL index auto-deletes stale data after 24 hours
- Cache status shown to user with timestamp

---

## Key Decisions & Trade-offs

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source | FMP API | Single API for all financial data, clean JSON, free tier |
| Database | MongoDB | JSON-native storage, perfect for financial data, free Atlas tier |
| Cache TTL | 24 hours | Fundamentals don't change intraday; saves API quota |
| LLM | Gemini Flash | Free tier, fast, good structured output for JSON |
| Agent pattern | LangGraph ReAct | Stateful, tool-calling, extensible |
| Stack | React + Node.js | Per assignment requirement |

**What I left out:**
- Real-time price streaming (needs WebSockets + paid data feed)
- DCF model computation (requires more assumptions)
- Indian stock support (FMP free tier focuses on US stocks)
- User auth / personal watchlists

---

## Example Runs

### Apple (AAPL)
```
Verdict: INVEST (Confidence: 87%)
Strengths: Massive FCF ($100B+), Brand moat, Services growth...
Risks: High valuation (P/E ~28), China dependency...
```

### Tesla (TSLA)
```
Verdict: HOLD (Confidence: 61%)
Strengths: EV market leader, Supercharger network moat...
Risks: Increasing competition, High P/E, Margin compression...
```

### Infosys (INFY)
```
Verdict: INVEST (Confidence: 74%)
Strengths: Consistent dividend, Strong FCF, IT services moat...
Risks: Rupee/Dollar exposure, Slow revenue growth...
```

---

## What I Would Improve With More Time

1. **Indian stocks (BSE/NSE)** — Add a secondary data source for Indian markets
2. **Streaming UI** — Stream agent steps to frontend in real-time via SSE
3. **PDF export** — Generate a printable investment report
4. **Comparison mode** — Analyze two companies side by side
5. **Portfolio tracker** — Track your invest/pass decisions over time
6. **Better valuation** — Add DCF model with user-adjustable assumptions
7. **Sector benchmarks** — Compare ratios vs sector averages automatically
