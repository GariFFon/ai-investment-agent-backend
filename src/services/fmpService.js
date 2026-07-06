import axios from 'axios';
import { fetchYahooData } from './yahooService.js';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const key = () => process.env.FMP_API_KEY;

const fmpGet = async (path) => {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${FMP_BASE}${path}${sep}apikey=${key()}`;
  console.log(`📡 FMP GET: ${url.replace(key(), '***')}`);
  const { data } = await axios.get(url);
  return data;
};

// ── 1. Search: company name → ticker ─────────────────────────────────────────
const searchCompany = async (query) => {
  const [byName, bySymbol] = await Promise.all([
    fmpGet(`/search-name?query=${encodeURIComponent(query)}&limit=5`).catch(() => []),
    fmpGet(`/search-symbol?query=${encodeURIComponent(query)}&limit=5`).catch(() => []),
  ]);
  const seen = new Set();
  const merged = [...(byName || []), ...(bySymbol || [])]
    .filter((r) => {
      if (seen.has(r.symbol)) return false;
      seen.add(r.symbol);
      return true;
    })
    .sort((a, b) => {
      const preferred = ['NASDAQ', 'NYSE', 'NYSE ARCA'];
      return (preferred.includes(a.exchange) ? 0 : 1) - (preferred.includes(b.exchange) ? 0 : 1);
    });
  if (!merged.length) throw new Error(`No company found for: ${query}`);
  return merged[0].symbol; // Return the best-match ticker
};

// ── 2. All financial data fetched in parallel ─────────────────────────────────
const fetchAllData = async (ticker) => {
  const [profile, income, balance, cashflow, metricsRaw, ratiosRaw, news, peersRaw] =
    await Promise.all([
      fmpGet(`/profile?symbol=${ticker}`).catch(() => null),
      fmpGet(`/income-statement?symbol=${ticker}&limit=3`).catch(() => []),
      fmpGet(`/balance-sheet-statement?symbol=${ticker}&limit=3`).catch(() => []),
      fmpGet(`/cash-flow-statement?symbol=${ticker}&limit=3`).catch(() => []),
      fmpGet(`/key-metrics?symbol=${ticker}&limit=1`).catch(() => []),
      fmpGet(`/ratios?symbol=${ticker}&limit=1`).catch(() => []),
      fmpGet(`/stock-news?symbol=${ticker}&limit=8`).catch(() => []),
      fmpGet(`/stock-peers?symbol=${ticker}`).catch(() => null),
    ]);

  // Normalize profile
  const p = (Array.isArray(profile) ? profile[0] : profile) || {};
  const companyProfile = {
    name: p.companyName,
    ticker: p.symbol,
    exchange: p.exchangeShortName,
    sector: p.sector,
    industry: p.industry,
    description: p.description,
    ceo: p.ceo,
    employees: p.fullTimeEmployees,
    marketCap: p.mktCap,
    price: p.price,
    beta: p.beta,
    website: p.website,
    country: p.country,
    ipoDate: p.ipoDate,
  };

  // Normalize income statement
  const incomeStatement = (income || []).map((d) => ({
    year: d.calendarYear,
    revenue: d.revenue,
    grossProfit: d.grossProfit,
    grossMargin: d.grossProfitRatio,
    operatingIncome: d.operatingIncome,
    operatingMargin: d.operatingIncomeRatio,
    netIncome: d.netIncome,
    netMargin: d.netIncomeRatio,
    eps: d.eps,
    ebitda: d.ebitda,
  }));

  // Normalize balance sheet
  const balanceSheet = (balance || []).map((d) => ({
    year: d.calendarYear,
    cash: d.cashAndCashEquivalents,
    totalAssets: d.totalAssets,
    totalDebt: d.totalDebt,
    totalLiabilities: d.totalLiabilities,
    totalEquity: d.totalStockholdersEquity,
    currentRatio: d.totalCurrentAssets / (d.totalCurrentLiabilities || 1),
  }));

  // Normalize cash flow
  const cashFlow = (cashflow || []).map((d) => ({
    year: d.calendarYear,
    operatingCashFlow: d.operatingCashFlow,
    capitalExpenditure: d.capitalExpenditure,
    freeCashFlow: d.freeCashFlow,
    dividendsPaid: d.dividendsPaid,
  }));

  // 🔍 DEBUG: log raw keys so we can verify field names (remove after confirming)
  const metricsRaw0 = Array.isArray(metricsRaw) ? metricsRaw[0] : metricsRaw;
  const ratiosRaw0  = Array.isArray(ratiosRaw)  ? ratiosRaw[0]  : ratiosRaw;
  console.log('📊 key-metrics keys:', Object.keys(metricsRaw0 || {}).join(', '));
  console.log('📊 ratios keys:', Object.keys(ratiosRaw0 || {}).join(', '));
  console.log('📊 key-metrics sample:', JSON.stringify({
    evToEBITDA:    metricsRaw0?.evToEBITDA,
    evToSales:     metricsRaw0?.evToSales,
    returnOnEquity:metricsRaw0?.returnOnEquity,
    returnOnAssets:metricsRaw0?.returnOnAssets,
    dividendYield: metricsRaw0?.dividendYield,
  }));
  console.log('📊 ratios sample:', JSON.stringify({
    priceEarningsRatio: ratiosRaw0?.priceEarningsRatio,
    priceToBookRatio:   ratiosRaw0?.priceToBookRatio,
    debtEquityRatio:    ratiosRaw0?.debtEquityRatio,
    interestCoverage:   ratiosRaw0?.interestCoverage,
    payoutRatio:        ratiosRaw0?.payoutRatio,
  }));

  // Normalize key metrics & ratios
  // NOTE: FMP /stable/key-metrics field names differ from legacy API
  const m = metricsRaw0 || {};
  const r = (Array.isArray(ratiosRaw) ? ratiosRaw[0] : ratiosRaw) || {};
  const keyMetrics = {
    // Valuation
    peRatio:                  r.priceEarningsRatio          ?? r.peRatio,
    pbRatio:                  r.priceToBookRatio            ?? r.pbRatio,
    priceToSales:             r.priceSalesRatio             ?? r.priceToSalesRatio ?? m.evToSales,
    evToEbitda:               m.evToEBITDA                  ?? m.enterpriseValueOverEBITDA,
    evToSales:                m.evToSales,
    evToFreeCashFlow:         m.evToFreeCashFlow,
    evToOperatingCashFlow:    m.evToOperatingCashFlow,
    grahamNumber:             m.grahamNumber,
    grahamNetNet:             m.grahamNetNet,
    earningsYield:            m.earningsYield,
    freeCashFlowYield:        m.freeCashFlowYield,
    // Profitability
    roe:                      m.returnOnEquity              ?? r.returnOnEquity,
    roa:                      m.returnOnAssets              ?? r.returnOnAssets,
    returnOnInvestedCapital:  m.returnOnInvestedCapital,
    returnOnCapitalEmployed:  m.returnOnCapitalEmployed,
    returnOnTangibleAssets:   m.returnOnTangibleAssets,
    incomeQuality:            m.incomeQuality,
    // Leverage & Coverage
    debtToEquity:             r.debtEquityRatio             ?? r.debtToEquityRatio ?? m.debtToEquity,
    netDebtToEBITDA:          m.netDebtToEBITDA,
    interestCoverage:         r.interestCoverage            ?? m.interestCoverage,
    interestBurden:           m.interestBurden,
    taxBurden:                m.taxBurden,
    // Liquidity
    currentRatio:             m.currentRatio                ?? r.currentRatio,
    quickRatio:               m.quickRatio                  ?? r.quickRatio,
    workingCapital:           m.workingCapital,
    // Dividends
    dividendYield:            m.dividendYield               ?? r.dividendYield,
    payoutRatio:              r.payoutRatio                 ?? m.payoutRatio,
    dividendPerShare:         m.dividendPerShare            ?? r.dividendPerShare,
    // Efficiency & CapEx
    capexToRevenue:                          m.capexToRevenue,
    capexToOperatingCashFlow:               m.capexToOperatingCashFlow,
    capexToDepreciation:                    m.capexToDepreciation,
    salesGeneralAndAdministrativeToRevenue: m.salesGeneralAndAdministrativeToRevenue,
    researchAndDevelopementToRevenue:       m.researchAndDevelopementToRevenue,
    stockBasedCompensationToRevenue:        m.stockBasedCompensationToRevenue,
    daysOfSalesOutstanding:                 m.daysOfSalesOutstanding,
    daysOfPayablesOutstanding:              m.daysOfPayablesOutstanding,
    daysOfInventoryOutstanding:             m.daysOfInventoryOutstanding,
    operatingCycle:                         m.operatingCycle,
    cashConversionCycle:                    m.cashConversionCycle,
    tangibleAssetValue:                     m.tangibleAssetValue,
    netCurrentAssetValue:                   m.netCurrentAssetValue,
    investedCapital:                        m.investedCapital,
  };

  // Normalize news
  const recentNews = (news || []).map((n) => ({
    title: n.title,
    date: n.publishedDate,
    summary: n.text?.slice(0, 200),
    source: n.site,
  }));

  // Normalize peers
  let peers = [];
  if (Array.isArray(peersRaw)) {
    peers = peersRaw[0]?.peersList || peersRaw.map((p) => p.symbol).filter(Boolean);
  } else {
    peers = peersRaw?.peersList || [];
  }

  return {
    ticker,
    companyProfile,
    incomeStatement,
    balanceSheet,
    cashFlow,
    keyMetrics,
    recentNews,
    peers: peers.slice(0, 5),
  };
};

/**
 * Main export: resolve company name → fetch all data in parallel from FMP + Yahoo
 * @param {string} companyName - Human-readable company name
 * @param {string|null} preferredTicker - If user already selected a specific symbol, skip search
 */
export const gatherCompanyData = async (companyName, preferredTicker = null) => {
  let ticker;
  if (preferredTicker) {
    console.log(`⚡ Using pre-selected ticker: ${preferredTicker} (skipping search)`);
    ticker = preferredTicker;
  } else {
    console.log(`🔍 Resolving ticker for "${companyName}"...`);
    ticker = await searchCompany(companyName);
    console.log(`✅ Ticker resolved: ${ticker}`);
  }

  // Fetch FMP + Yahoo Finance data in parallel
  console.log(`📊 Fetching FMP + Yahoo Finance data for ${ticker} in parallel...`);
  const [fmpData, yahooData] = await Promise.all([
    fetchAllData(ticker),
    fetchYahooData(ticker).catch((err) => {
      console.warn(`⚠️ Yahoo Finance fetch failed, continuing with FMP only: ${err.message}`);
      return null;
    }),
  ]);
  console.log(`✅ All data fetched for ${ticker} (Yahoo: ${yahooData ? '✅' : '❌ unavailable'})`);

  // Merge: FMP is primary, Yahoo fills gaps and adds extra data
  return {
    ...fmpData,
    // Override description with Yahoo's longer version if FMP description is short
    companyProfile: {
      ...fmpData.companyProfile,
      description: (
        fmpData.companyProfile?.description?.length > 100
          ? fmpData.companyProfile.description
          : yahooData?.profile?.description
      ) ?? fmpData.companyProfile?.description,
      employees: fmpData.companyProfile?.employees ?? yahooData?.profile?.employees,
    },
    // Yahoo-exclusive enriched data (analyst intelligence, ownership, earnings beats)
    yahooData: yahooData ?? null,
  };
};
