# IntellyInvest — Data Sources & Feature Suggestions

## 🔵 Current Data Sources

| Source | What it provides | Cost |
|---|---|---|
| **Financial Modeling Prep (FMP)** | Company profile, income/balance/cashflow statements, key metrics & ratios, recent news, peer companies | Free tier (limited calls) |
| **Yahoo Finance** (via `yahoo-finance2`) | Analyst ratings, EPS estimates, earnings beats/misses, institutional ownership, upgrade/downgrade history | Free (no key) |
| **Google Gemini AI** | AI narrative analysis, bull/bear thesis, investment verdict, confidence score | Paid per-token (free quota) |
| **MongoDB** | Caches all analyses, stores history for sidebar | Self-hosted / Atlas free |

---

## 💡 New Screens to Add

### 1. 📊 Stock Price Chart Screen
Show a live/historical price chart (1D, 1W, 1M, 1Y, 5Y) using:
- **Alpha Vantage** (free) or **Yahoo Finance** `chart` endpoint
- Use `Recharts` or `Chart.js` — already easy to add
- Show candlestick or line chart with volume bars underneath
- Overlay analyst **price targets** (high/low/mean from Yahoo data you already have!)

### 2. 🆚 Peer Comparison Screen
You already fetch peers — build a side-by-side comparison table:
- Columns: P/E, P/B, ROE, Gross Margin, Revenue Growth, Market Cap
- Highlight the best value in each column with green
- Let user click any peer to analyze it instantly

### 3. 📰 News Feed Screen / Tab
- You already fetch 8 news articles per company via FMP
- Build a dedicated news tab with article cards: title, source, date, summary
- Add sentiment tagging (positive/negative/neutral) via Gemini in a single cheap call

### 4. 🏦 Financials Deep-Dive Screen
Dedicated screen showing interactive charts for:
- Revenue trend (bar chart, last 3–5 years)
- Net Income trend
- Free Cash Flow trend
- Gross/Operating/Net margins over time
- All data already available from FMP income statements!

### 5. 🔔 Watchlist & Alerts Screen
- Let users "star" companies to a watchlist
- Store in MongoDB (trivial addition)
- Show watchlist in sidebar below history
- Later: add price alert thresholds (email via Resend/Nodemailer)

### 6. 🌍 Sector Overview Screen
- Show all S&P 500 / NSE sectors
- Use FMP `/sector-performance` endpoint (free)
- Heatmap-style grid showing best/worst performing sectors today
- Click a sector → see top companies in it

### 7. 📈 Portfolio Simulator
- User adds companies with a hypothetical allocation (e.g., 40% NVDA, 30% AAPL)
- Show blended metrics: weighted P/E, weighted dividend yield, overall risk score
- All calculations from data you already have — no new API needed

### 8. 🤖 AI Chat About a Company
- After an analysis loads, add a chat input at the bottom
- User can ask follow-up questions: "What's the biggest risk?", "Compare to Microsoft"
- Send question + stored analysis JSON to Gemini for a focused answer
- Very cheap (only the question, not re-fetching all data)

---

## 🔌 Additional Data Sources to Integrate

| Source | What you'd gain | Effort |
|---|---|---|
| **Alpha Vantage** (free) | Historical OHLCV price data for charts | Low |
| **SEC EDGAR** (free) | Official filings: 10-K, 10-Q, 8-K | Medium |
| **FRED (St. Louis Fed)** | Macro context: interest rates, inflation, GDP | Low |
| **Finnhub** (free tier) | Insider transactions, earnings calendar | Low |
| **OpenInsider** | Insider buying/selling signals | Low (scraping) |

---

## 🎨 UI Improvements to Consider

- **Dark mode toggle** — your CSS vars make this trivial
- **Export to PDF** — print the analysis card (use `window.print()` + print CSS)
- **Share link** — generate a shareable URL for a cached analysis `/analysis/NVDA`
- **Keyboard shortcut map** — show all shortcuts in a modal (you already have ⌘K)
- **Onboarding tooltip tour** — for new users using `Shepherd.js`
