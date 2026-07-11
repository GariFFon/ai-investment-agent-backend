import YahooFinance from 'yahoo-finance2';
import { fetchScreenerData } from './screenerService.js';
import { fetchYahooData } from './yahooService.js';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

/**
 * Detect if a ticker refers to an Indian exchange listing.
 * Checks for .NS (NSE) and .BO (BSE) suffixes.
 */
export const isIndianTicker = (ticker) =>
  /\.(NS|BO)$/i.test(ticker);

/**
 * Search for Indian stocks using Yahoo Finance's search endpoint.
 * Returns results with .NS / .BO suffixes included.
 *
 * @param {string} query - Company name or ticker
 * @returns {Array} Array of { symbol, name, exchange, exchangeFullName, currency }
 */
export const searchIndianCompanies = async (query) => {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=0&quotesCount=20`;
  try {
    const { default: axios } = await import('axios');
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
      },
      timeout: 8000,
    });

    const quotes = data?.quotes || [];
    return quotes
      .filter((q) => q.quoteType === 'EQUITY' && q.symbol)
      .filter((q) => /\.(NS|BO)$/i.test(q.symbol))
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        exchangeFullName: q.exchDisp || q.exchange,
        currency: 'INR',
        country: 'India',
      }));
  } catch (err) {
    console.warn(`⚠️ Yahoo Indian search failed: ${err.message}`);
    return [];
  }
};

/**
 * Fetch multi-year historical financials (income, balance sheet, cash flow)
 * from Yahoo Finance for Indian stocks.
 *
 * Used as a FALLBACK when Screener.in is unavailable or returns 404.
 * Yahoo Finance supports these modules for NSE/BSE tickers without any auth.
 */
const fetchYahooHistoricals = async (ticker) => {
  console.log(`📊 Yahoo Finance historicals (fallback): Fetching for ${ticker}...`);
  try {
    const raw = await yahooFinance.quoteSummary(ticker, {
      modules: [
        'incomeStatementHistory',
        'balanceSheetHistory',
        'cashflowStatementHistory',
      ],
    });

    // Normalize income statement (last 4 annual periods)
    const incomeStatement = (raw.incomeStatementHistory?.incomeStatementHistory || []).map((d) => {
      const year = d.endDate ? new Date(d.endDate).getFullYear().toString() : null;
      const revenue = d.totalRevenue ?? null;
      const netIncome = d.netIncome ?? null;
      const grossProfit = d.grossProfit ?? null;
      const operatingIncome = d.ebit ?? d.operatingIncome ?? null;
      const grossMargin = revenue && grossProfit ? grossProfit / revenue : null;
      const netMargin = revenue && netIncome ? netIncome / revenue : null;
      const operatingMargin = revenue && operatingIncome ? operatingIncome / revenue : null;
      return {
        year,
        revenue,
        grossProfit,
        grossMargin,
        operatingIncome,
        operatingMargin,
        netIncome,
        netMargin,
        eps: null,
        ebitda: null,
      };
    });

    // Normalize balance sheet (last 4 annual periods)
    const balanceSheet = (raw.balanceSheetHistory?.balanceSheetStatements || []).map((d) => ({
      year: d.endDate ? new Date(d.endDate).getFullYear().toString() : null,
      cash: d.cash ?? null,
      totalAssets: d.totalAssets ?? null,
      totalDebt: d.longTermDebt ?? null,
      totalLiabilities: d.totalLiab ?? null,
      totalEquity: d.totalStockholderEquity ?? null,
      currentRatio: d.totalCurrentAssets && d.totalCurrentLiabilities
        ? d.totalCurrentAssets / d.totalCurrentLiabilities
        : null,
    }));

    // Normalize cash flow (last 4 annual periods)
    const cashFlow = (raw.cashflowStatementHistory?.cashflowStatements || []).map((d) => ({
      year: d.endDate ? new Date(d.endDate).getFullYear().toString() : null,
      operatingCashFlow: d.totalCashFromOperatingActivities ?? null,
      capitalExpenditure: d.capitalExpenditures ?? null,
      freeCashFlow:
        d.totalCashFromOperatingActivities != null && d.capitalExpenditures != null
          ? d.totalCashFromOperatingActivities + d.capitalExpenditures
          : null,
      dividendsPaid: d.dividendsPaid ?? null,
    }));

    console.log(
      `✅ Yahoo historicals: ${incomeStatement.length} income, ${balanceSheet.length} balance, ${cashFlow.length} cashflow years`
    );
    return { incomeStatement, balanceSheet, cashFlow };
  } catch (err) {
    console.warn(`⚠️ Yahoo historicals failed for ${ticker}: ${err.message}`);
    return { incomeStatement: [], balanceSheet: [], cashFlow: [] };
  }
};

/**
 * Build key metrics from Yahoo Finance data when Screener.in is unavailable.
 */
const buildKeyMetricsFromYahoo = (yahooData) => {
  const yfc = yahooData?.currentFinancials ?? {};
  const yfk = yahooData?.keyStats ?? {};
  return {
    peRatio:         yfk.forwardPE ?? null,
    pbRatio:         yfk.priceToBook ?? null,
    priceToSales:    yfk.priceToSales ?? null,
    evToEbitda:      yfk.enterpriseToEbitda ?? null,
    roe:             yfc.returnOnEquity ?? null,
    roa:             yfc.returnOnAssets ?? null,
    returnOnInvestedCapital: null,
    returnOnCapitalEmployed: null,
    debtToEquity:    yfc.debtToEquity ?? null,
    currentRatio:    yfc.currentRatio ?? null,
    quickRatio:      yfc.quickRatio ?? null,
    dividendYield:   yfk.dividendYield ?? null,
    payoutRatio:     yfk.payoutRatio ?? null,
    interestCoverage: null,
    netDebtToEBITDA:  null,
    beta:            yfk.beta ?? null,
  };
};

/**
 * Build a cross-source comparison for Indian companies.
 * Primary: Screener.in | Supplementary: Yahoo Finance
 */
const buildIndianCrossSource = (screenerData, yahooData, yahooHistoricals) => {
  // Prefer Screener data, fall back to Yahoo historicals
  const income   = screenerData?.incomeStatement?.[0]   ?? yahooHistoricals?.incomeStatement?.[0] ?? {};
  const balance  = screenerData?.balanceSheet?.[0]       ?? yahooHistoricals?.balanceSheet?.[0]    ?? {};
  const cashflow = screenerData?.cashFlow?.[0]            ?? yahooHistoricals?.cashFlow?.[0]        ?? {};
  const km       = screenerData?.keyMetrics ?? buildKeyMetricsFromYahoo(yahooData);
  const yfc      = yahooData?.currentFinancials ?? {};
  const yfk      = yahooData?.keyStats ?? {};

  const agreement = (vals) => {
    const nums = vals.filter((v) => v != null && !isNaN(v));
    if (nums.length < 2) return 'SINGLE';
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    if (max === 0) return 'HIGH';
    const spread = (max - min) / Math.abs(max);
    if (spread <= 0.05) return 'HIGH';
    if (spread <= 0.15) return 'MEDIUM';
    return 'LOW';
  };

  const makePoint = (label, screener, yahoo, fmt = 'currency') => ({
    label,
    screener: screener ?? null,
    yahoo:    yahoo    ?? null,
    agreement: agreement([screener, yahoo]),
    format: fmt,
    displayValue: screener ?? yahoo ?? null,
  });

  return {
    revenue:          makePoint('Revenue (Latest FY)',           income.revenue,          yfc.totalRevenue),
    netIncome:        makePoint('Net Income (Latest FY)',        income.netIncome,        null),
    operatingIncome:  makePoint('Operating Income (Latest FY)',  income.operatingIncome,  null),
    ebitda:           makePoint('EBITDA (Latest FY)',            income.ebitda,           yfc.ebitda),
    eps:              makePoint('EPS (Latest FY)',               income.eps,              yfk.trailingEps, 'number'),
    totalDebt:        makePoint('Total Debt (Latest FY)',        balance.totalDebt,       yfc.totalDebt),
    operatingCashFlow:makePoint('Operating Cash Flow',          cashflow.operatingCashFlow, yfc.operatingCashflow),
    debtToEquity:     makePoint('Debt/Equity Ratio',            km.debtToEquity,         yfc.debtToEquity, 'number'),
    roe:              makePoint('Return on Equity (ROE)',        km.roe,                  yfc.returnOnEquity, 'percent'),
    grossMargin:      makePoint('Gross Margin',                 income.grossMargin,      yfc.grossMargins, 'percent'),
    operatingMargin:  makePoint('Operating Margin',             income.operatingMargin,  yfc.operatingMargins, 'percent'),
    netMargin:        makePoint('Net Profit Margin',            income.netMargin,        yfc.profitMargins, 'percent'),
  };
};

/**
 * Main entry point: gather all data for an Indian company.
 *
 * Data source priority:
 *   1. Screener.in (multi-year fundamentals, ratios, shareholding)
 *   2. Yahoo Finance historicals (fallback for income/balance/cashflow when Screener fails)
 *   3. Yahoo Finance summary (analyst data, ownership, estimates — always fetched)
 *
 * Returns the SAME data shape as gatherCompanyData() in fmpService.js.
 *
 * @param {string} ticker - Ticker with .NS or .BO suffix (e.g. "RELIANCE.NS")
 * @returns {object} Normalized company data
 */
export const gatherIndianCompanyData = async (ticker) => {
  console.log(`🇮🇳 Indian pipeline: Gathering data for ${ticker}...`);

  // Fetch all sources in parallel
  const [screenerData, yahooData] = await Promise.all([
    fetchScreenerData(ticker),
    fetchYahooData(ticker).catch((err) => {
      console.warn(`⚠️ Yahoo Finance failed for Indian ticker ${ticker}: ${err.message}`);
      return null;
    }),
  ]);

  if (!screenerData && !yahooData) {
    throw new Error(`No data found for Indian company: ${ticker}. Check the ticker symbol.`);
  }

  // If Screener.in failed, get multi-year historical data from Yahoo Finance as fallback
  let yahooHistoricals = null;
  if (!screenerData) {
    console.log(`🔄 Screener.in unavailable — fetching Yahoo Finance historical statements as fallback...`);
    yahooHistoricals = await fetchYahooHistoricals(ticker);
  }

  // ── Merge: Screener.in is primary, Yahoo fills gaps ───────────────────────
  const sp = screenerData?.companyProfile ?? {};
  const yp = yahooData?.profile ?? {};

  const companyProfile = {
    name:        sp.name ?? (yahooData?.currentFinancials ? null : null),
    ticker,
    exchange:    sp.exchange ?? (ticker.endsWith('.BO') ? 'BSE' : 'NSE'),
    sector:      sp.sector   ?? yp.sector,
    industry:    sp.industry ?? yp.industry,
    description: (sp.description?.length > 100 ? sp.description : null) ?? yp.description ?? sp.description,
    website:     sp.website  ?? yp.website,
    marketCap:   sp.marketCap,
    price:       sp.price    ?? yahooData?.currentFinancials?.currentPrice,
    country:     'India',
    employees:   sp.employees ?? yp.employees,
    currency:    'INR',
    ceo:         null,
    ipoDate:     null,
    beta:        screenerData?.keyMetrics?.beta ?? yahooData?.keyStats?.beta,
  };

  // Final income/balance/cashflow — Screener first, Yahoo historicals as fallback
  const incomeStatement = screenerData?.incomeStatement?.length
    ? screenerData.incomeStatement
    : (yahooHistoricals?.incomeStatement ?? []);

  const balanceSheet = screenerData?.balanceSheet?.length
    ? screenerData.balanceSheet
    : (yahooHistoricals?.balanceSheet ?? []);

  const cashFlow = screenerData?.cashFlow?.length
    ? screenerData.cashFlow
    : (yahooHistoricals?.cashFlow ?? []);

  // Key metrics — Screener first, build from Yahoo if unavailable
  const keyMetrics = (screenerData?.keyMetrics && Object.keys(screenerData.keyMetrics).some((k) => screenerData.keyMetrics[k] != null))
    ? screenerData.keyMetrics
    : buildKeyMetricsFromYahoo(yahooData);

  // Build cross-source comparison
  const crossSource = buildIndianCrossSource(screenerData, yahooData, yahooHistoricals);

  const dataSource = screenerData
    ? 'screener.in + yahoo-finance'
    : 'yahoo-finance (screener.in unavailable)';
  console.log(`✅ Indian pipeline complete for ${ticker} — source: ${dataSource}`);

  return {
    ticker,
    market: 'INDIA',
    currency: 'INR',
    companyProfile,
    incomeStatement,
    balanceSheet,
    cashFlow,
    keyMetrics,
    recentNews: [],
    peers: screenerData?.peers ?? [],
    // Supplementary
    yahooData: yahooData ?? null,
    edgarData: null, // Always null for Indian companies
    crossSource,
    // Indian-specific data
    indianData: {
      shareholding:     screenerData?.shareholding     ?? null,
      quarterlyResults: screenerData?.quarterlyResults ?? [],
      ratiosList:       screenerData?.ratiosList       ?? [],
      screenerSymbol:   screenerData?.symbol           ?? null,
      dataSource,
    },
  };
};
