import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch comprehensive company data from Yahoo Finance (free, no API key needed).
 * Supplements FMP data with analyst ratings, earnings estimates,
 * institutional ownership, and more.
 *
 * @param {string} ticker - Stock ticker symbol e.g. "AAPL"
 * @returns {object|null} Normalized Yahoo Finance data, or null on failure
 */
export const fetchYahooData = async (ticker) => {
  console.log(`🦆 Yahoo Finance: Fetching data for ${ticker}...`);

  // Core modules for analyst data, ownership, and estimates
  const modules = [
    'summaryProfile',
    'financialData',
    'defaultKeyStatistics',
    'recommendationTrend',
    'earningsTrend',
    'majorHoldersBreakdown',
    'upgradeDowngradeHistory',
    'earnings',
  ];

  // Retry with exponential backoff to handle Yahoo's 429 rate-limiting on crumb fetch
  const MAX_RETRIES = 3;
  let raw;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      raw = await yahooFinance.quoteSummary(ticker, { modules });
      break; // success
    } catch (err) {
      const is429 = err.message?.includes('429') || err.message?.includes('Too Many Requests');
      if (is429 && attempt < MAX_RETRIES) {
        const delay = attempt * 2000; // 2s, 4s, 6s
        console.warn(`⚠️ Yahoo Finance rate-limited (429) for ${ticker}. Retrying in ${delay / 1000}s... (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      // Not a 429, or out of retries — try stripped-down fallback
      console.warn(`⚠️ Yahoo Finance full fetch failed for ${ticker}: ${err.message}`);
      try {
        raw = await yahooFinance.quoteSummary(ticker, {
          modules: ['summaryProfile', 'financialData', 'defaultKeyStatistics'],
        });
        break;
      } catch (err2) {
        console.error(`❌ Yahoo Finance fallback also failed: ${err2.message}`);
        return null;
      }
    }
  }


  // Fetch fundamentals time series separately (best post-Nov 2024 source)
  let fundamentals = null;
  try {
    fundamentals = await yahooFinance.fundamentalsTimeSeries(ticker, {
      type: 'annual',
      module: 'financials',
      period1: new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000), // 4 years back
    });
  } catch (err) {
    console.warn(`⚠️ Yahoo fundamentalsTimeSeries failed for ${ticker}: ${err.message}`);
  }

  if (!raw) return null;


  // 1. Profile
  const sp = raw.summaryProfile || {};
  const profile = {
    description:  sp.longBusinessSummary,
    sector:       sp.sector,
    industry:     sp.industry,
    employees:    sp.fullTimeEmployees,
    country:      sp.country,
    website:      sp.website,
    city:         sp.city,
    state:        sp.state,
  };

  // 2. Current Financials
  const fd = raw.financialData || {};
  const currentFinancials = {
    currentPrice:             fd.currentPrice,
    targetHighPrice:          fd.targetHighPrice,
    targetLowPrice:           fd.targetLowPrice,
    targetMeanPrice:          fd.targetMeanPrice,
    targetMedianPrice:        fd.targetMedianPrice,
    recommendationMean:       fd.recommendationMean,
    recommendationKey:        fd.recommendationKey,
    numberOfAnalystOpinions:  fd.numberOfAnalystOpinions,
    totalRevenue:             fd.totalRevenue,
    revenuePerShare:          fd.revenuePerShare,
    revenueGrowth:            fd.revenueGrowth,
    grossProfits:             fd.grossProfits,
    grossMargins:             fd.grossMargins,
    operatingMargins:         fd.operatingMargins,
    ebitdaMargins:            fd.ebitdaMargins,
    profitMargins:            fd.profitMargins,
    earningsGrowth:           fd.earningsGrowth,
    totalCash:                fd.totalCash,
    totalCashPerShare:        fd.totalCashPerShare,
    totalDebt:                fd.totalDebt,
    debtToEquity:             fd.debtToEquity,
    currentRatio:             fd.currentRatio,
    quickRatio:               fd.quickRatio,
    returnOnAssets:           fd.returnOnAssets,
    returnOnEquity:           fd.returnOnEquity,
    freeCashflow:             fd.freeCashflow,
    operatingCashflow:        fd.operatingCashflow,
    ebitda:                   fd.ebitda,
  };

  // 3. Key Statistics
  const ks = raw.defaultKeyStatistics || {};
  const keyStats = {
    enterpriseValue:            ks.enterpriseValue,
    forwardPE:                  ks.forwardPE,
    pegRatio:                   ks.pegRatio,
    priceToBook:                ks.priceToBook,
    priceToSales:               ks.priceToSalesTrailing12Months,
    enterpriseToRevenue:        ks.enterpriseToRevenue,
    enterpriseToEbitda:         ks.enterpriseToEbitda,
    beta:                       ks.beta,
    trailingEps:                ks.trailingEps,
    forwardEps:                 ks.forwardEps,
    bookValuePerShare:          ks.bookValue,
    sharesOutstanding:          ks.sharesOutstanding,
    floatShares:                ks.floatShares,
    sharesShort:                ks.sharesShort,
    shortRatio:                 ks.shortRatio,
    shortPercentOfFloat:        ks.shortPercentOfFloat,
    heldPercentInsiders:        ks.heldPercentInsiders,
    heldPercentInstitutions:    ks.heldPercentInstitutions,
    dividendYield:              ks.dividendYield,
    payoutRatio:                ks.payoutRatio,
    weekChange52:               ks['52WeekChange'],
    lastSplitFactor:            ks.lastSplitFactor,
  };

  // 4. Income Statement History (last 4 years)
  const incomeHistory = (raw.incomeStatementHistory?.incomeStatementHistory || []).map((d) => ({
    endDate:                d.endDate,
    totalRevenue:           d.totalRevenue,
    grossProfit:            d.grossProfit,
    operatingIncome:        d.operatingIncome,
    netIncome:              d.netIncome,
    ebit:                   d.ebit,
    researchDevelopment:    d.researchDevelopment,
    totalOperatingExpenses: d.totalOperatingExpenses,
  }));

  // 5. Balance Sheet History (last 4 years)
  const balanceHistory = (raw.balanceSheetHistory?.balanceSheetStatements || []).map((d) => ({
    endDate:                  d.endDate,
    cash:                     d.cash,
    shortTermInvestments:     d.shortTermInvestments,
    totalCurrentAssets:       d.totalCurrentAssets,
    totalAssets:              d.totalAssets,
    totalCurrentLiabilities:  d.totalCurrentLiabilities,
    totalLiabilities:         d.totalLiab,
    totalStockholderEquity:   d.totalStockholderEquity,
    longTermDebt:             d.longTermDebt,
    retainedEarnings:         d.retainedEarnings,
  }));

  // 6. Cash Flow History (last 4 years)
  const cashflowHistory = (raw.cashflowStatementHistory?.cashflowStatements || []).map((d) => ({
    endDate:                            d.endDate,
    netIncome:                          d.netIncome,
    depreciation:                       d.depreciation,
    totalCashFromOperatingActivities:   d.totalCashFromOperatingActivities,
    capitalExpenditures:                d.capitalExpenditures,
    dividendsPaid:                      d.dividendsPaid,
    freeCashFlow:                       (d.totalCashFromOperatingActivities || 0) + (d.capitalExpenditures || 0),
  }));

  // 7. Analyst Recommendation Trend
  const analystRecommendations = (raw.recommendationTrend?.trend || []).slice(0, 2).map((t) => ({
    period:     t.period,
    strongBuy:  t.strongBuy,
    buy:        t.buy,
    hold:       t.hold,
    sell:       t.sell,
    strongSell: t.strongSell,
  }));

  // 8. EPS & Revenue Estimates
  const epsEstimates = (raw.earningsTrend?.trend || []).slice(0, 4).map((t) => ({
    period:    t.period,
    endDate:   t.endDate,
    growth:    t.growth,
    epsAvg:    t.earningsEstimate?.avg,
    epsLow:    t.earningsEstimate?.low,
    epsHigh:   t.earningsEstimate?.high,
    revAvg:    t.revenueEstimate?.avg,
    yearAgoEps: t.earningsEstimate?.yearAgoEps,
  }));

  // 9. Ownership Breakdown
  const mh = raw.majorHoldersBreakdown || {};
  const ownership = {
    insidersPercent:          mh.insidersPercentHeld,
    institutionsPercent:      mh.institutionsPercentHeld,
    institutionsCount:        mh.institutionsCount,
    institutionsFloatPercent: mh.institutionsFloatPercentHeld,
  };

  // 10. Analyst Upgrades/Downgrades (last 8)
  const analystActions = (raw.upgradeDowngradeHistory?.history || []).slice(0, 8).map((a) => ({
    date:      a.epochGradeDate,
    firm:      a.firm,
    toGrade:   a.toGrade,
    fromGrade: a.fromGrade,
    action:    a.action,
  }));

  // 11. Quarterly Earnings Beats/Misses
  const earningsHistory = (raw.earnings?.earningsChart?.quarterly || []).slice(0, 4).map((q) => ({
    date:     q.date,
    actual:   q.actual,
    estimate: q.estimate,
    surprise: q.actual && q.estimate
      ? Math.round(((q.actual - q.estimate) / Math.abs(q.estimate)) * 10000) / 100
      : null,
  }));

  console.log(`✅ Yahoo Finance data fetched for ${ticker}`);

  return {
    source: 'yahoo-finance',
    ticker,
    profile,
    currentFinancials,
    keyStats,
    analystRecommendations,
    epsEstimates,
    ownership,
    analystActions,
    earningsHistory,
    // fundamentalsTimeSeries: richer annual financials (post-Nov 2024)
    fundamentals: fundamentals ?? null,
  };
};
