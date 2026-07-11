# IntellyInvest — AI Investment Research Agent

> Built for the InsideIIM × Altuni AI Labs — AI Product Intern Assignment.

---

## Overview

**IntellyInvest** is a full-stack AI-powered investment research agent. Given any publicly listed company name, it autonomously gathers financial data from multiple sources, cross-validates it, and produces a structured **INVEST / HOLD / PASS** verdict with full quantitative reasoning — in seconds.

### What it does

- 🔍 **Spotlight Search** (`⌘K`) — Type any company name or ticker; queries FMP + Yahoo Finance in parallel, supporting both US (NASDAQ/NYSE) and Indian (NSE/BSE) markets.
- 📊 **Multi-source Data Gathering** — For US companies: FMP API (primary) + Yahoo Finance (analyst consensus, ownership, earnings beats) + SEC EDGAR (official 10-K/10-Q filings). For Indian companies: Screener.in (web scraping via Cheerio) + Yahoo Finance.
- 🤖 **Gemini AI Synthesis** — All gathered data is bundled into a single rich prompt and sent to **Gemini 2.5 Flash** in one API call. The model returns a structured JSON verdict.
- 📋 **Structured Verdict** — Every analysis returns: `INVEST / HOLD / PASS`, confidence score (0–100), 4 strengths, 3 risks, a detailed reasoning paragraph, and a full financial summary (revenue, margins, P/E, ROE, ROCE, FCF, market cap).
- 💾 **MongoDB Cache** — Results are persisted to MongoDB Atlas. Repeat searches return instantly (zero API calls) for up to 30 days.
- 📈 **Stock Chart** — Interactive price history chart rendered with Recharts, with currency-aware display (₹ vs $).
- 📁 **Analysis History** — Sidebar panel listing all previously analyzed companies for one-click reload.

---

## How to Run

### Prerequisites

- **Node.js 18+**
- **MongoDB Atlas** account (free 512 MB cluster)
- Three API keys (all free tiers):

| Key | Where to get |
|-----|-------------|
| `FMP_API_KEY` | [financialmodelingprep.com](https://financialmodelingprep.com) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |
| `MONGODB_URI` | [cloud.mongodb.com](https://cloud.mongodb.com) |

### 1. Clone & Install

```bash
git clone <repo-url>
cd ai-investment-agent
```

### 2. Setup the Server

```bash
cd server
cp .env.example .env
# Edit .env — fill in your three API keys
npm install
npm run dev
# Server runs on http://localhost:5000
```

**`.env` contents:**
```env
FMP_API_KEY=your_fmp_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
MONGODB_URI=your_mongodb_atlas_connection_string
PORT=5000
CLIENT_URL=http://localhost:5173
```

### 3. Setup the Client

```bash
cd client
cp .env.example .env
# Default .env already points to http://localhost:5000 — no changes needed
npm install
npm run dev
# Frontend runs on http://localhost:5173
```

### 4. Open in Browser

```
http://localhost:5173
```

Press `⌘K` (Mac) or `Ctrl+K` (Windows) to open Spotlight search. Type any company name and press Enter.

---

## How It Works

### High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    React Frontend (Vite)                       │
│   SpotlightModal → SearchBar → ResultCard + StockChart         │
└───────────────────────────┬────────────────────────────────────┘
                            │ POST /api/analyze
                            ▼
┌────────────────────────────────────────────────────────────────┐
│                 Express.js Backend (Node.js)                   │
│  Routes: /analyze  /search  /chart  /history  /company        │
└──────────┬─────────────────────────────────────────────────────┘
           │
           ├─ 1. Check MongoDB Cache (30-day TTL)
           │        Cache HIT → return instantly (0 API calls)
           │
           └─ 2. Cache MISS → runAnalysisAgent()
                      │
          ┌───────────▼────────────────────────────────────────┐
          │              gatherCompanyData()                   │
          │                                                    │
          │  isIndianTicker? (.NS / .BO)                       │
          │       YES → Screener.in + Yahoo Finance pipeline   │
          │       NO  → US Pipeline (parallel Promise.all):    │
          │             ┌──────────┐ ┌──────────┐ ┌────────┐  │
          │             │ FMP API  │ │  Yahoo   │ │ EDGAR  │  │
          │             │(primary) │ │(enriched)│ │(offic.)│  │
          │             └──────────┘ └──────────┘ └────────┘  │
          │                     ↓ cross-source comparison      │
          │             (HIGH / MEDIUM / LOW agreement)        │
          └───────────┬────────────────────────────────────────┘
                      │
          ┌───────────▼────────────────────────────────────────┐
          │          Gemini 2.5 Flash (1 API call)             │
          │  systemInstruction: ANALYST_PROMPT (8-dimension)   │
          │  responseMimeType: application/json                │
          │  temperature: 0.1  →  structured JSON verdict      │
          └───────────┬────────────────────────────────────────┘
                      │
          ┌───────────▼────────────────────────────────────────┐
          │           MongoDB Atlas (Mongoose)                  │
          │   upsert by ticker → 30-day TTL expiry             │
          └────────────────────────────────────────────────────┘
```

### Data Sources & What They Provide

#### US Companies (NYSE / NASDAQ)

| Source | Data Fetched |
|--------|-------------|
| **FMP API** | Company profile, income statement (3yr), balance sheet (3yr), cash flow (3yr), key metrics & ratios (30+ fields), recent news (8 articles), peer companies |
| **Yahoo Finance** | Analyst consensus (buy/hold/sell counts + mean score), EPS estimates (next 4 periods), earnings beats/misses history, institutional/insider ownership breakdown, analyst upgrades/downgrades, forward P/E, PEG ratio, short %, 52-week change |
| **SEC EDGAR** | Official 10-K annual revenue, net income, EPS diluted, R&D expense, operating cash flow, total assets, shares outstanding; latest 10-K/10-Q filing dates, recent 8-K count |

#### Indian Companies (NSE / BSE)

| Source | Data Fetched |
|--------|-------------|
| **Screener.in** (Cheerio web scrape) | Company profile, quarterly results (last 8 quarters with revenue, net profit, OPM%), shareholding pattern with quarterly trend (Promoter/FII/DII/Public %), multi-year key ratios |
| **Yahoo Finance** | Analyst consensus, price history, key stats for NSE/BSE tickers |

### Agent Flow — Step by Step

1. **Ticker Resolution** — FMP name search + FMP symbol search run in parallel. Detected Indian tickers (`.NS` / `.BO` suffix) are smart-routed to the Indian pipeline.
2. **Data Gathering** — All external API calls run concurrently (`Promise.all`). No sequential blocking — typically completes in 3–5 seconds.
3. **Cross-Source Validation** (US only) — 16 overlapping data points (revenue, net income, EPS, ROE, ROA, margins, assets, cash flow, D/E ratio, etc.) are compared across FMP, Yahoo, and EDGAR. Agreement level (HIGH ≤2% spread / MEDIUM ≤10% / LOW >10%) is computed and embedded in the Gemini prompt.
4. **Prompt Assembly** — All data formatted into a structured markdown prompt (~3,000–5,000 tokens). One shot, no tool calls, no loops.
5. **Gemini Call** — `gemini-2.5-flash` with `responseMimeType: 'application/json'` and `temperature: 0.1` for deterministic, structured output. No markdown fences in output.
6. **JSON Parsing & Return** — Result (including full raw financial data as `rawData`) is upserted to MongoDB by ticker, then returned to the frontend.

### Analyst Framework (Gemini System Prompt)

The `ANALYST_PROMPT` instructs Gemini to evaluate companies across 8 dimensions:

1. **Business Quality** — Is the product essential? Is demand growing?
2. **Financial Health** — Revenue growth, margins, cash flow, debt levels
3. **Profitability** — ROE, ROCE, net margins vs industry peers
4. **Valuation** — P/E, EV/EBITDA vs historical and peers
5. **Competitive Moat** — Brand, network effect, patents, switching costs
6. **Growth Prospects** — Revenue CAGR, market expansion, new products
7. **Risk Factors** — Debt, competition, regulation, macro headwinds
8. **Recent News** — Catalysts or red flags?

**Verdict rules:**
- `INVEST` — Strong fundamentals, reasonable valuation, clear moat, growing business
- `HOLD` — Good company but overvalued, or mixed signals — wait for better entry
- `PASS` — Poor fundamentals, declining business, excessive debt, or no moat

**Indian-specific rules** (applied when ticker ends in `.NS` / `.BO`):
- ROCE > 15% is good; > 25% is excellent (primary metric for Indian investors)
- Promoter holding > 50% signals founder commitment; pledged shares = red flag
- OPM (Operating Profit Margin) is the standard Indian metric — always mentioned
- Debt/Equity < 1 is safe; > 2 is a serious red flag
- Quarterly momentum (sequential revenue/profit acceleration) is tracked

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/analyze` | Run analysis (with MongoDB cache). Body: `{ companyName, ticker?, force? }` |
| `GET` | `/api/search?q=...` | Search companies (FMP + Yahoo Finance merged, deduplicated) |
| `GET` | `/api/chart/:ticker` | Historical price data for chart |
| `GET` | `/api/history` | List all previously analyzed companies |
| `GET` | `/api/company/:ticker` | Fetch a cached analysis by ticker |
| `GET` | `/health` | Health check |

### Caching Strategy

- **First search**: fetches from all APIs → runs Gemini → upserts to MongoDB by ticker
- **Repeat search** (within 30 days): returns cached result instantly — zero external API calls
- **Force refresh**: pass `force: true` in the POST body to bypass cache
- **TTL**: MongoDB TTL index on `fetchedAt` expires documents after **30 days** (2,592,000 seconds)
- **Cache indicator**: frontend shows a "Cached · [timestamp]" badge on cached results

---

## Key Decisions & Trade-offs

| Decision | Choice Made | Rationale |
|----------|-------------|-----------|
| **LLM call strategy** | Single Gemini call (not multi-step ReAct loop) | Fetching all data first then calling Gemini once is faster, cheaper, and more predictable. Eliminates risk of the LLM calling wrong tools or getting stuck in a loop. |
| **AI model** | Gemini 2.5 Flash | Free tier, fast (~5s), excellent structured JSON output via `responseMimeType`. Temperature 0.1 keeps analysis deterministic and reproducible. |
| **Primary data source** | FMP API | Single REST API covering profile + income + balance sheet + cash flow + metrics + news + peers in one set of parallel calls. Clean normalized JSON. Free tier covers most global tickers. |
| **Indian market support** | Screener.in (web scrape) + Yahoo Finance | FMP free tier has limited Indian stock coverage. Screener.in has deep Indian fundamentals (quarterly results, shareholding patterns, OPM history). Cheerio used for server-side HTML parsing. |
| **Multi-source validation** | FMP + Yahoo Finance + SEC EDGAR cross-comparison | Cross-validating 16 data points across 3 independent sources and flagging LOW agreement adds data reliability that a single-source system can't provide. |
| **Database** | MongoDB Atlas (Mongoose) | JSON-native, free tier, perfect for storing variable-shape financial data blobs. Upsert-by-ticker prevents duplicates. |
| **Cache TTL** | 30 days | Company fundamentals don't change intraday or weekly. 30 days balances freshness with API quota conservation. Force-refresh always available. |
| **Frontend** | React 19 + Vite + Vanilla CSS | Per assignment requirement. Vite for fast HMR. Custom CSS design system (`index.css`) — no Tailwind. Recharts for charts. |
| **Search UX** | Spotlight modal (`⌘K`) | Familiar power-user pattern (VS Code, Linear). 320ms debounce prevents hammering the search API on every keystroke. |

### What I Left Out (and Why)

- **Real-time price streaming** — Needs WebSockets + paid data feed; overkill for fundamentals analysis
- **DCF model** — Requires user-adjustable assumptions (WACC, growth rate, terminal value) — valuable but a separate complex feature
- **User auth / watchlists** — Out of scope; requires sessions and user-specific MongoDB collections
- **PDF export** — Nice-to-have; would use a headless browser or `@react-pdf/renderer`
- **Streaming agent steps** — The single-call architecture makes the ~8s analysis a single wait. SSE streaming of progress would improve UX.

---

## Example Runs

### Apple (AAPL) — US Stock

```
Verdict:    INVEST
Confidence: 87%
Strengths:
  • Massive FCF ($100B+) funding buybacks and dividends
  • Unmatched brand loyalty and ecosystem lock-in (1.5B active devices)
  • Services segment (App Store, iCloud, Apple TV+) growing at 15%+ YoY
  • Net cash positive balance sheet — zero financial distress risk
Risks:
  • Premium valuation (P/E ~28x) leaves little margin for disappointment
  • ~17% revenue concentration in China creates geopolitical exposure
  • iPhone upgrade cycle elongating as hardware innovation slows
Financial:  Revenue: $391B | Net Margin: 24% | ROE: 160%+ | P/E: 28x | FCF: $100B+
```

### Tesla (TSLA) — US Stock

```
Verdict:    HOLD
Confidence: 58%
Strengths:
  • Global EV market leader with the largest fast-charging network (Supercharger)
  • Full Self-Driving software creates high-margin recurring revenue potential
  • Energy storage (Megapack) is a fast-growing, underappreciated business
  • Gigafactory scale gives structural manufacturing cost advantage
Risks:
  • Intense competition from BYD and legacy OEMs compressing market share
  • Gross margin decline (29% → 18%) from aggressive price cuts
  • Very high P/E (70–80x) prices in perfection; any miss punished severely
Financial:  Revenue: $97B | Gross Margin: 18% | P/E: ~75x | D/E: 0.18
```

### Reliance Industries (RELIANCE.NS) — Indian Stock

```
Verdict:    INVEST
Confidence: 76%
Strengths:
  • Diversified conglomerate (O2C, Jio Telecom, Retail) provides earnings stability
  • Jio's 450M+ subscriber base with ARPU expansion is a multi-year growth engine
  • Strong promoter holding (50%+); no pledged shares
  • ROCE consistently improving as new energy capex matures
Risks:
  • Massive capex in New Energy (green hydrogen, solar) weighs on FCF for 3–5 years
  • Regulatory risk across telecom, retail, and petrochemicals segments
  • Complex group structure makes cross-segment analysis difficult
Financial:  Revenue: ₹9,01,425 Cr | Net Margin: 8.2% | ROCE: 12.4% | P/E: 24x
```

### Infosys (INFY.NS) — Indian Stock

```
Verdict:    INVEST
Confidence: 72%
Strengths:
  • Consistent 38% ROCE — gold standard for Indian IT services
  • Strong FCF generation with 90%+ cash conversion; shareholder-friendly
  • Diversified client base across BFSI, retail, manufacturing, and healthcare
  • Dividend yield ~2.5% with consistent payout history
Risks:
  • Revenue growth slowing to 4–6% as global IT spending remains cautious
  • USD/INR exposure — currency volatility impacts reported INR earnings
  • Attrition and wage inflation pressures on margins
Financial:  Revenue: ₹1,53,670 Cr | OPM: 20.7% | ROCE: 38% | P/E: 22x
```

---

## What I Would Improve With More Time

1. **Streaming progress updates** — Use Server-Sent Events (SSE) to push step-by-step status ("Fetching SEC EDGAR…", "Running Gemini analysis…") to the frontend, eliminating the 8–15s blank wait.

2. **DCF valuation model** — Add a discounted cash flow tab with user-adjustable inputs (WACC, FCF growth rate, terminal multiple) so users can stress-test the valuation themselves.

3. **Side-by-side comparison** — Analyze two companies simultaneously with a split-pane view, including a head-to-head metrics table.

4. **Sector benchmarks** — Automatically pull sector/industry median P/E, ROE, and margin data to show where a company sits relative to peers — not just a list of peer tickers.

5. **PDF export** — Generate a professional, printable investment research report from the analysis JSON.

6. **Portfolio tracker** — Let users mark companies as INVEST/PASS and track the performance of their paper portfolio over time.

7. **Deeper Indian data** — Add NSE bulk deals, block deals, and corporate actions (dividends, bonuses, splits) from NSE's official data feed to enrich Indian company analysis.

8. **Alert system** — Email/Slack notifications when a re-analysis changes the verdict (e.g., HOLD → INVEST) for a company the user previously analyzed.

---

## Project Structure

```
ai-investment-agent/
├── server/                          # Node.js + Express backend
│   ├── src/
│   │   ├── index.js                 # Entry point: Express setup, route registration
│   │   ├── agent/
│   │   │   └── graph.js             # Core: gatherCompanyData() + Gemini synthesis
│   │   ├── services/
│   │   │   ├── fmpService.js        # FMP API (US primary) + cross-source comparison
│   │   │   ├── yahooService.js      # Yahoo Finance (analyst data, ownership, estimates)
│   │   │   ├── edgarService.js      # SEC EDGAR (official 10-K/10-Q filing data)
│   │   │   ├── screenerService.js   # Screener.in web scraper (Indian fundamentals)
│   │   │   └── indianDataService.js # Indian company orchestration + Yahoo fallback
│   │   ├── routes/
│   │   │   ├── analyze.js           # POST /api/analyze (MongoDB cache + agent)
│   │   │   ├── search.js            # GET /api/search (FMP + Yahoo merged)
│   │   │   ├── chart.js             # GET /api/chart/:ticker (price history)
│   │   │   ├── history.js           # GET /api/history (past analyses list)
│   │   │   └── company.js           # GET /api/company/:ticker (single lookup)
│   │   ├── prompts/
│   │   │   └── analyst.js           # Gemini system prompt (8-dimension + JSON schema)
│   │   ├── models/
│   │   │   └── Analysis.js          # Mongoose schema (30-day TTL, upsert by ticker)
│   │   └── db/
│   │       └── connect.js           # MongoDB Atlas connection
│   ├── .env.example
│   └── package.json
│
└── client/                          # React 19 + Vite frontend
    ├── src/
    │   ├── App.jsx                  # Root: SpotlightModal, layout, state
    │   ├── components/
    │   │   ├── ResultCard.jsx       # Full analysis display (verdict, metrics, reasoning)
    │   │   ├── StockChart.jsx       # Recharts price history chart (₹/$ aware)
    │   │   ├── SearchBar.jsx        # Search input
    │   │   ├── HistoryPanel.jsx     # Sidebar: previously analyzed companies
    │   │   ├── LoadingState.jsx     # Wave loading animation
    │   │   └── MetricGrid.jsx       # Reusable financial metrics grid
    │   ├── services/
    │   │   └── api.js               # Axios API calls to backend
    │   └── index.css                # Full CSS design system (dark mode, glassmorphism)
    └── package.json
```

---

## Dependencies

### Server

| Package | Purpose |
|---------|---------|
| `@google/generative-ai` ^0.24.1 | Gemini 2.5 Flash API client |
| `@langchain/core` ^0.3.0 | Installed (LangGraph peer dep) |
| `@langchain/google-genai` ^0.1.0 | Installed (LangGraph peer dep) |
| `@langchain/langgraph` ^0.2.0 | Installed; agent uses native Gemini SDK directly |
| `axios` ^1.7.0 | HTTP client for all external API calls |
| `cheerio` ^1.2.0 | Server-side HTML parsing for Screener.in |
| `express` ^4.19.0 | HTTP server framework |
| `mongoose` ^8.5.0 | MongoDB ODM (schema, TTL, upsert) |
| `yahoo-finance2` ^3.15.4 | Yahoo Finance data (Indian stocks, analyst data) |
| `dotenv` ^16.4.0 | Environment variable management |

### Client

| Package | Purpose |
|---------|---------|
| `react` / `react-dom` ^19.2.7 | UI framework |
| `react-router-dom` ^7.18.1 | Client-side routing |
| `recharts` ^3.9.2 | Stock price history charts |
| `axios` ^1.18.1 | HTTP client for backend API calls |
| `motion` ^12.42.2 | Animation (loading states, transitions) |
| `lucide-react` ^1.23.0 | Icon set |
| `vite` ^8.1.1 | Build tool & dev server |
