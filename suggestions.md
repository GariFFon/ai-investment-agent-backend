# IntellyInvest — Data Sources, Features & Suggestions

**🌐 Live:** [ai-investment-agent-client.vercel.app](https://ai-investment-agent-client.vercel.app/) | **⚙️ API:** [ai-investment-agent-backend-9mfy.onrender.com](https://ai-investment-agent-backend-9mfy.onrender.com)

---

## 🟢 Current Data Sources (Implemented)

| Source | What it provides | Cost | Market |
|--------|-----------------|------|--------|
| **FMP (Financial Modeling Prep)** | Company profile, income/balance/cashflow statements (3yr), key metrics & ratios (30+ fields), recent news (8 articles), peer companies | Free tier | US + Global |
| **Yahoo Finance** (via `yahoo-finance2`) | Analyst ratings, EPS/revenue estimates, earnings beats/misses, institutional & insider ownership, upgrade/downgrade history, forward P/E, PEG, short interest, 52-week change | Free (no key) | US + India |
| **SEC EDGAR** (U.S. Gov. API) | Official 10-K/10-Q annual revenue, net income, EPS diluted, R&D expense, operating cash flow, total assets, shares outstanding; latest filing dates, recent 8-K count | Free (public) | US only |
| **Screener.in** (Cheerio web scrape) | Quarterly results (last 8 quarters), shareholding pattern with trend (Promoter/FII/DII/Public %), multi-year key ratios, ROCE history | Free (scrape) | India (NSE/BSE) |
| **Yahoo Finance RSS** | Live market headlines — S&P 500, NASDAQ, Bitcoin, Top Stocks; 5-min in-memory cache | Free (no key) | Global |
| **Google Gemini 2.5 Flash** | AI synthesis: INVEST/PASS verdict, confidence score (0-100), 4 strengths, 3 risks, detailed reasoning, full financial summary JSON | Free quota | All |
| **MongoDB Atlas** | Persists all analyses indefinitely (no TTL — admin deletes manually); powers History sidebar and instant cache hits | Atlas free tier | All |

---

## Completed Features (Originally Suggested — Now Built)

| Suggestion | Status | Notes |
|------------|--------|-------|
| Stock price chart | DONE | StockChart.jsx using Recharts + /api/chart/:ticker via FMP |
| News feed screen | DONE | /api/news route fetches Yahoo Finance RSS; displayed in frontend |
| SEC EDGAR integration | DONE | edgarService.js fetches official 10-K/10-Q data; cross-validated with FMP + Yahoo |
| Indian market support | DONE | screenerService.js + indianDataService.js; Screener.in scrape for NSE/BSE |
| Analysis history sidebar | DONE | HistoryPanel.jsx + /api/history endpoint |
| Persistent storage (no expiry) | DONE | MongoDB schema has no TTL index — data retained until admin deletes |
| Binary verdict (no HOLD) | DONE | Analyst prompt outputs only INVEST or PASS; PASS covers overvalued/mixed signals |
| Multi-source data validation | DONE | 16 data points cross-compared across FMP, Yahoo, EDGAR — flagged HIGH/MEDIUM/LOW agreement in Gemini prompt |
| Spotlight search (Cmd+K) | DONE | SearchBar.jsx with 320ms debounce; FMP + Yahoo merged results |
| Force re-analysis | DONE | force: true in POST body bypasses MongoDB cache |
| Deployed frontend | DONE | Vercel — https://ai-investment-agent-client.vercel.app/ |
| Deployed backend (Docker) | DONE | Render — https://ai-investment-agent-backend-9mfy.onrender.com |

---

## Remaining Suggestions (Not Yet Built)

### 1. Peer Comparison Screen
You already fetch peers from FMP — build a side-by-side comparison table:
- Columns: P/E, P/B, ROE, Gross Margin, Revenue Growth, Market Cap
- Highlight the best value in each column in green
- Click any peer to analyze it instantly
- Effort: Low — all data already available

### 2. Financials Deep-Dive Screen
Dedicated screen with interactive charts using data already fetched:
- Revenue trend (bar chart, last 3-5 years)
- Net Income trend
- Free Cash Flow trend
- Gross / Operating / Net margins over time
- Effort: Low — zero new API calls needed

### 3. Watchlist & Alerts
- Let users star companies to a personal watchlist
- Store in MongoDB (trivial schema addition)
- Show watchlist in sidebar below History panel
- Future: email alerts via Resend/Nodemailer when verdict changes on re-analysis
- Effort: Medium

### 4. DCF Valuation Model
Add a discounted cash flow tab with user-adjustable inputs:
- WACC, FCF growth rate, terminal multiple
- Stress-test the intrinsic value; compare to current price
- All FCF data already available from FMP cash flow statements
- Effort: Medium

### 5. AI Chat About a Company
After an analysis loads, add a chat input at the bottom:
- User asks follow-up questions: "What's the biggest risk?", "Compare to Microsoft"
- Send question + stored analysis JSON to Gemini — very cheap (no re-fetch)
- Effort: Low

### 6. Sector Overview Screen
- Show S&P 500 / NSE sector performance
- Use FMP /sector-performance (free endpoint)
- Heatmap grid showing best/worst sectors
- Click a sector to see top companies in it
- Effort: Low

### 7. Portfolio Simulator
- User allocates hypothetical weights (e.g., 40% NVDA, 30% AAPL)
- Show blended metrics: weighted P/E, dividend yield, overall risk score
- All calculations from data already cached — no new API needed
- Effort: Medium

### 8. PDF Export
- Export the full analysis card as a printable report
- Use window.print() + print CSS, or @react-pdf/renderer for a proper PDF
- Effort: Low-Medium

---

## Additional Data Sources to Consider

| Source | What you'd gain | Effort | Cost |
|--------|----------------|--------|------|
| FRED (St. Louis Fed) | Macro context: interest rates, inflation, GDP — adds economic backdrop to analysis | Low | Free |
| Finnhub (free tier) | Insider transactions, earnings calendar | Low | Free |
| OpenInsider | Insider buying/selling signals (web scrape) | Low | Free |
| NSE Official API | NSE bulk deals, block deals, corporate actions (dividends, splits, bonuses) | Medium | Free |
| Alpha Vantage | OHLCV historical price data (alternative to FMP chart) | Low | Free |
| Bloomberg / Refinitiv / premium FMP | European, Chinese, Japanese stock fundamentals | High | Paid — reason other country markets are not supported |

Note on geographic coverage: US and Indian markets are the only two currently supported because free, reliable, machine-readable fundamentals data is available for both. All other major markets (LSE, Tokyo, Hong Kong, Euronext) require paid data subscriptions — out of scope for this project.

---

## UI Improvements to Consider

- Streaming progress updates — SSE to show "Fetching EDGAR...", "Running Gemini..." during the 8-15s analysis wait
- Share link — generate a shareable URL for a cached analysis (e.g., /analysis/NVDA)
- Side-by-side company comparison — split-pane with head-to-head metrics table
- Sector benchmarks — show where a company's P/E / ROE sits vs its sector median
- Export to PDF — print-friendly version of the ResultCard
- Keyboard shortcut map — show all shortcuts in a modal (already have Cmd+K)
- Onboarding tooltip tour — for new users via Shepherd.js
