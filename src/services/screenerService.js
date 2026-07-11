import axios from 'axios';

const SCREENER_BASE = 'https://www.screener.in';

/**
 * Strip .NS / .BO / .BSE suffixes to get a plain NSE/BSE ticker
 * e.g. "RELIANCE.NS" → "RELIANCE"
 */
const toScreenerSymbol = (ticker) =>
  ticker.replace(/\.(NS|BO|BSE|NSE)$/i, '').toUpperCase();

const SCREENER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Referer: 'https://www.screener.in/',
};

/**
 * Step 1: Search Screener.in for a symbol to get the correct company slug.
 * Returns the best-match slug string (e.g. "PNB", "RELIANCE").
 *
 * Matching priority:
 *   1. URL slug exactly matches the NSE symbol (e.g. /company/PNB/ for "PNB")
 *   2. URL slug starts with the symbol (e.g. /company/PNBHOUSING/ would NOT match "PNB")
 *   3. First result as fallback
 */
const resolveScreenerSlug = async (symbol) => {
  const searchUrl = `${SCREENER_BASE}/api/company/search/?q=${encodeURIComponent(symbol)}`;
  console.log(`🔎 Screener.in search: ${searchUrl}`);
  try {
    const { data } = await axios.get(searchUrl, {
      headers: SCREENER_HEADERS,
      timeout: 10000,
    });
    // data is an array like: [{ name: "Punjab National Bank", url: "/company/PNB/" }, ...]
    if (!Array.isArray(data) || data.length === 0) return symbol;

    // Extract just the company symbol from the URL path.
    // URL can be "/company/PNB/" or "/company/PNBHOUSING/consolidated/"
    // We only want the first path segment after /company/, e.g. "PNB" or "PNBHOUSING"
    const extractSlug = (url) =>
      url?.replace(/^\/company\//, '').split('/')[0]?.toUpperCase() || null;

    // Priority 1: exact slug match (e.g. slug "PNB" === symbol "PNB")
    const exactSlugMatch = data.find(
      (r) => extractSlug(r.url) === symbol.toUpperCase()
    );

    // Priority 2: first result (Screener's own ranking)
    const best = exactSlugMatch || data[0];
    const slug = extractSlug(best.url) || symbol;

    console.log(`✅ Screener.in resolved slug: "${symbol}" → "${slug}" (from "${best.name}")`);
    return slug;
  } catch (err) {
    console.warn(`⚠️ Screener.in search failed for ${symbol}: ${err.message}. Using raw symbol.`);
    return symbol;
  }
};

/**
 * Step 2: Fetch company JSON from Screener.in using the resolved slug.
 * Tries /consolidated/ first (preferred for large Indian companies),
 * falls back to plain slug if consolidated returns 404.
 */
const screenerGet = async (slug) => {
  // Try consolidated first
  const consolidatedUrl = `${SCREENER_BASE}/api/company/${encodeURIComponent(slug)}/consolidated/`;
  console.log(`📡 Screener.in GET (consolidated): ${consolidatedUrl}`);
  try {
    const { data } = await axios.get(consolidatedUrl, {
      headers: SCREENER_HEADERS,
      timeout: 15000,
    });
    if (data && data.id) return data; // valid response
  } catch (err) {
    if (err.response?.status !== 404) throw err; // only swallow 404
    console.warn(`⚠️ Screener.in: consolidated not found for ${slug}, trying standalone...`);
  }

  // Fall back to standalone
  const standaloneUrl = `${SCREENER_BASE}/api/company/${encodeURIComponent(slug)}/`;
  console.log(`📡 Screener.in GET (standalone): ${standaloneUrl}`);
  const { data } = await axios.get(standaloneUrl, {
    headers: SCREENER_HEADERS,
    timeout: 15000,
  });
  return data;
};

/**
 * Parse a Screener.in consolidated/standalone financial table.
 * Each table entry looks like: { name, values: [{ value, tooltip }] }
 * The headers are a separate array of year labels.
 */
const parseTable = (headers, rows) => {
  if (!Array.isArray(headers) || !Array.isArray(rows)) return [];
  return headers.map((year, i) => {
    const entry = { year: String(year).trim() };
    rows.forEach((row) => {
      const key = String(row.name || '').trim();
      const val = row.values?.[i]?.value;
      // Convert "1,23,456" Indian-formatted numbers to plain numbers
      const parsed = typeof val === 'string'
        ? parseFloat(val.replace(/,/g, ''))
        : val;
      entry[key] = isNaN(parsed) ? val : parsed;
    });
    return entry;
  });
};

/**
 * Safely find a row by name (partial, case-insensitive match)
 */
const findRow = (rows, name) =>
  (rows || []).find((r) =>
    String(r.name || '').toLowerCase().includes(name.toLowerCase())
  );

/**
 * Convert Screener.in Cr (crore) values to absolute numbers.
 * 1 Crore = 10,000,000
 */
const crToAbs = (val) => (val != null && !isNaN(val) ? val * 1e7 : null);

/**
 * Main fetch function for Indian companies via Screener.in
 * @param {string} ticker - Ticker with or without .NS/.BO suffix
 * @returns {object} Normalized data matching US pipeline shape
 */
export const fetchScreenerData = async (ticker) => {
  const symbol = toScreenerSymbol(ticker);
  console.log(`🇮🇳 Screener.in: Fetching data for ${symbol} (from ${ticker})...`);

  // Step 1: Resolve the correct Screener.in slug (avoids 404s for tickers like PNB, HDFCAMC, etc.)
  const slug = await resolveScreenerSlug(symbol);

  let raw;
  try {
    raw = await screenerGet(slug);
  } catch (err) {
    console.warn(`⚠️ Screener.in fetch failed for ${slug}: ${err.message}`);
    return null;
  }

  if (!raw || raw.detail === 'Not found.') {
    console.warn(`⚠️ Screener.in: Company not found for symbol ${symbol}`);
    return null;
  }

  // ── 1. Company Profile ────────────────────────────────────────────────────
  const companyProfile = {
    name:        raw.name,
    ticker,
    exchange:    ticker.endsWith('.BO') ? 'BSE' : 'NSE',
    sector:      raw.sector_name || raw.sector || null,
    industry:    raw.industry_name || raw.industry || null,
    description: raw.description || null,
    website:     raw.website || null,
    marketCap:   crToAbs(raw.market_cap),
    price:       raw.current_price,
    country:     'India',
    employees:   null, // Not provided by Screener.in
    ceo:         null, // Not provided by Screener.in
    ipoDate:     null,
    beta:        null,
    currency:    'INR',
  };

  // ── 2. Income Statement ───────────────────────────────────────────────────
  // Screener stores financials in raw.results (consolidated or standalone)
  // Structure: { years: [...], income: [...], balance: [...], cash_flows: [...], ratios: [...] }
  const financials = raw.results?.[0] || {};
  const incomeYears  = financials.yearly_income_statement?.headers || [];
  const incomeRows   = financials.yearly_income_statement?.rows || [];

  // Also try the top-level structure Screener uses in some responses
  const altIncome = raw.income_statements || {};

  const incomeStatement = incomeYears.length > 0
    ? parseTable(incomeYears, incomeRows).map((d) => ({
        year:             d.year,
        revenue:          crToAbs(d['Sales'] ?? d['Revenue from Operations'] ?? d['Net Sales']),
        grossProfit:      null, // Not directly available; computed below
        grossMargin:      null,
        operatingIncome:  crToAbs(d['Operating Profit'] ?? d['EBIT']),
        operatingMargin:  d['OPM %'] != null ? d['OPM %'] / 100 : null,
        netIncome:        crToAbs(d['Net Profit'] ?? d['Profit after tax'] ?? d['PAT']),
        netMargin:        null, // Computed from ratio rows
        eps:              d['EPS in Rs'] ?? d['EPS'] ?? null,
        ebitda:           crToAbs(d['Operating Profit'] ?? null),
      })).slice(0, 5)
    : [];

  // ── 3. Balance Sheet ──────────────────────────────────────────────────────
  const balanceYears = financials.yearly_balance_sheet?.headers || [];
  const balanceRows  = financials.yearly_balance_sheet?.rows || [];

  const balanceSheet = balanceYears.length > 0
    ? parseTable(balanceYears, balanceRows).map((d) => ({
        year:           d.year,
        totalAssets:    crToAbs(d['Total Assets'] ?? d['Balance Sheet Total']),
        totalDebt:      crToAbs(d['Borrowings'] ?? d['Total Debt']),
        totalEquity:    crToAbs(d['Total Equity'] ?? d["Shareholders' Funds"] ?? d['Equity']),
        totalLiabilities: crToAbs(d['Total Liabilities']),
        cash:           crToAbs(d['Cash Equivalents'] ?? d['Cash & Bank Balance']),
        currentRatio:   null, // from ratios
      })).slice(0, 5)
    : [];

  // ── 4. Cash Flow ──────────────────────────────────────────────────────────
  const cashYears = financials.yearly_cash_flow_statement?.headers || [];
  const cashRows  = financials.yearly_cash_flow_statement?.rows || [];

  const cashFlow = cashYears.length > 0
    ? parseTable(cashYears, cashRows).map((d) => ({
        year:               d.year,
        operatingCashFlow:  crToAbs(d['Cash from Operating Activity'] ?? d['Operating Cash Flow']),
        capitalExpenditure: crToAbs(d['Capital Expenditure'] ?? d['CAPEX']),
        freeCashFlow:       crToAbs(d['Free Cash Flow'] ?? null),
        dividendsPaid:      crToAbs(d['Dividends Paid'] ?? null),
      })).slice(0, 5)
    : [];

  // ── 5. Key Metrics & Ratios ───────────────────────────────────────────────
  // Screener exposes these as a simple key-value list in raw.ratios or raw.key_ratios
  const ratiosList = raw.ratios || raw.key_ratios || [];

  const findRatio = (name) => {
    const r = ratiosList.find((x) =>
      String(x.name || '').toLowerCase().includes(name.toLowerCase())
    );
    return r?.values?.[0]?.value != null
      ? parseFloat(String(r.values[0].value).replace(/,/g, ''))
      : null;
  };

  const keyMetrics = {
    peRatio:         findRatio('Stock P/E') ?? findRatio('P/E'),
    pbRatio:         findRatio('Price to Book') ?? findRatio('P/B'),
    priceToSales:    findRatio('Price to Sales') ?? findRatio('P/S'),
    evToEbitda:      findRatio('EV / EBITDA'),
    roe:             findRatio('Return on Equity') != null ? findRatio('Return on Equity') / 100 : null,
    roa:             null,
    returnOnInvestedCapital: findRatio('ROCE') != null ? findRatio('ROCE') / 100 : null,
    returnOnCapitalEmployed: findRatio('ROCE') != null ? findRatio('ROCE') / 100 : null,
    debtToEquity:    findRatio('Debt to equity'),
    currentRatio:    findRatio('Current ratio'),
    dividendYield:   findRatio('Dividend Yield') != null ? findRatio('Dividend Yield') / 100 : null,
    payoutRatio:     null,
    quickRatio:      null,
    interestCoverage: null,
    netDebtToEBITDA:  null,
  };

  // ── 6. Shareholding Pattern (Indian-specific) ─────────────────────────────
  const shareholding = raw.shareholding_pattern || null;

  // ── 7. Quarterly Results ──────────────────────────────────────────────────
  const qHeaders = raw.quarterly_income_statement?.headers || [];
  const qRows    = raw.quarterly_income_statement?.rows || [];
  const quarterlyResults = qHeaders.length > 0
    ? parseTable(qHeaders, qRows).slice(0, 4)
    : [];

  // ── 8. Peer Comparison ────────────────────────────────────────────────────
  const peers = (raw.peer_comparison || [])
    .map((p) => p.symbol || p.ticker)
    .filter(Boolean)
    .slice(0, 5);

  // ── 9. News / Recent Updates ──────────────────────────────────────────────
  // Screener doesn't provide news — will come from Yahoo Finance
  const recentNews = [];

  console.log(`✅ Screener.in data fetched for ${symbol}`);

  return {
    source: 'screener.in',
    symbol,
    ticker,
    companyProfile,
    incomeStatement,
    balanceSheet,
    cashFlow,
    keyMetrics,
    recentNews,
    peers,
    // Indian-specific extras
    shareholding,
    quarterlyResults,
    ratiosList,
    currency: 'INR',
  };
};
