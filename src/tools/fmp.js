import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import axios from 'axios';

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const key = () => process.env.FMP_API_KEY;

const fmpGet = async (path) => {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${FMP_BASE}${path}${sep}apikey=${key()}`;
  console.log(`📡 FMP GET: ${url.replace(key(), '***')}`);
  const { data } = await axios.get(url);
  return data;
};

// ── 1. Search company name → ticker ──────────────────────────────────────────
export const searchCompanyTool = tool(
  async ({ query }) => {
    // Try both name and symbol search, merge results
    const [byName, bySymbol] = await Promise.all([
      fmpGet(`/search-name?query=${encodeURIComponent(query)}&limit=5`).catch(() => []),
      fmpGet(`/search-symbol?query=${encodeURIComponent(query)}&limit=5`).catch(() => []),
    ]);
    // Combine & deduplicate by symbol, prefer NASDAQ/NYSE listings
    const seen = new Set();
    const merged = [...(byName || []), ...(bySymbol || [])]
      .filter((r) => {
        if (seen.has(r.symbol)) return false;
        seen.add(r.symbol);
        return true;
      })
      // Prefer major US exchanges
      .sort((a, b) => {
        const preferred = ['NASDAQ', 'NYSE', 'NYSE ARCA'];
        const aScore = preferred.includes(a.exchange) ? 0 : 1;
        const bScore = preferred.includes(b.exchange) ? 0 : 1;
        return aScore - bScore;
      });
    if (!merged.length) return JSON.stringify({ error: 'No company found' });
    return JSON.stringify(
      merged.slice(0, 4).map((r) => ({
        symbol: r.symbol,
        name: r.name,
        exchange: r.exchangeFullName || r.exchange,
      }))
    );
  },
  {
    name: 'search_company',
    description: 'Search for a company by name to get its stock ticker symbol.',
    schema: z.object({ query: z.string().describe('Company name to search') }),
  }
);

// ── 2. Company profile ────────────────────────────────────────────────────────
export const getProfileTool = tool(
  async ({ ticker }) => {
    const data = await fmpGet(`/profile?symbol=${ticker}`);
    // stable endpoint returns array or single object
    const arr = Array.isArray(data) ? data : [data];
    if (!arr?.length || !arr[0]?.symbol) return JSON.stringify({ error: 'Profile not found' });
    const p = arr[0];
    return JSON.stringify({
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
    });
  },
  {
    name: 'get_company_profile',
    description: 'Get business overview, sector, industry, CEO, market cap for a company.',
    schema: z.object({ ticker: z.string().describe('Stock ticker symbol e.g. AAPL') }),
  }
);

// ── 3. Income statement (last 3 years) ───────────────────────────────────────
export const getIncomeStatementTool = tool(
  async ({ ticker }) => {
    const data = await fmpGet(`/income-statement?symbol=${ticker}&limit=3`);
    if (!data?.length) return JSON.stringify({ error: 'No income data' });
    return JSON.stringify(
      data.map((d) => ({
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
      }))
    );
  },
  {
    name: 'get_income_statement',
    description: 'Get revenue, profit, margins, EPS for the last 3 years.',
    schema: z.object({ ticker: z.string() }),
  }
);

// ── 4. Balance sheet ─────────────────────────────────────────────────────────
export const getBalanceSheetTool = tool(
  async ({ ticker }) => {
    const data = await fmpGet(`/balance-sheet-statement?symbol=${ticker}&limit=3`);
    if (!data?.length) return JSON.stringify({ error: 'No balance sheet data' });
    return JSON.stringify(
      data.map((d) => ({
        year: d.calendarYear,
        cash: d.cashAndCashEquivalents,
        totalAssets: d.totalAssets,
        totalDebt: d.totalDebt,
        totalLiabilities: d.totalLiabilities,
        totalEquity: d.totalStockholdersEquity,
        currentRatio: d.totalCurrentAssets / (d.totalCurrentLiabilities || 1),
      }))
    );
  },
  {
    name: 'get_balance_sheet',
    description: 'Get cash, debt, assets, liabilities, equity for last 3 years.',
    schema: z.object({ ticker: z.string() }),
  }
);

// ── 5. Cash flow ─────────────────────────────────────────────────────────────
export const getCashFlowTool = tool(
  async ({ ticker }) => {
    const data = await fmpGet(`/cash-flow-statement?symbol=${ticker}&limit=3`);
    if (!data?.length) return JSON.stringify({ error: 'No cash flow data' });
    return JSON.stringify(
      data.map((d) => ({
        year: d.calendarYear,
        operatingCashFlow: d.operatingCashFlow,
        capitalExpenditure: d.capitalExpenditure,
        freeCashFlow: d.freeCashFlow,
        dividendsPaid: d.dividendsPaid,
      }))
    );
  },
  {
    name: 'get_cash_flow',
    description: 'Get operating cash flow, free cash flow, capex for last 3 years.',
    schema: z.object({ ticker: z.string() }),
  }
);

// ── 6. Key metrics & ratios ───────────────────────────────────────────────────
export const getKeyMetricsTool = tool(
  async ({ ticker }) => {
    const [metrics, ratios] = await Promise.all([
      fmpGet(`/key-metrics?symbol=${ticker}&limit=1`),
      fmpGet(`/ratios?symbol=${ticker}&limit=1`),
    ]);
    const m = (Array.isArray(metrics) ? metrics[0] : metrics) || {};
    const r = (Array.isArray(ratios) ? ratios[0] : ratios) || {};
    return JSON.stringify({
      peRatio: m.peRatio,
      pbRatio: m.pbRatio,
      evToEbitda: m.enterpriseValueOverEBITDA,
      priceToSales: m.priceToSalesRatio,
      debtToEquity: m.debtToEquity,
      roe: r.returnOnEquity,
      roa: r.returnOnAssets,
      interestCoverage: r.interestCoverage,
      dividendYield: m.dividendYield,
      payoutRatio: r.payoutRatio,
    });
  },
  {
    name: 'get_key_metrics',
    description: 'Get valuation ratios (P/E, P/B, EV/EBITDA) and ROE, ROA.',
    schema: z.object({ ticker: z.string() }),
  }
);

// ── 7. Recent news ────────────────────────────────────────────────────────────
export const getNewsTool = tool(
  async ({ ticker }) => {
    const data = await fmpGet(`/stock-news?symbol=${ticker}&limit=8`);
    if (!data?.length) return JSON.stringify({ error: 'No news found' });
    return JSON.stringify(
      data.map((n) => ({
        title: n.title,
        date: n.publishedDate,
        summary: n.text?.slice(0, 200),
        source: n.site,
      }))
    );
  },
  {
    name: 'get_company_news',
    description: 'Get recent news articles about the company.',
    schema: z.object({ ticker: z.string() }),
  }
);

// ── 8. Peers / competitors ────────────────────────────────────────────────────
export const getPeersTool = tool(
  async ({ ticker }) => {
    const data = await fmpGet(`/stock-peers?symbol=${ticker}`);
    // stable returns array of peer objects or {peersList:[...]}
    let peers = [];
    if (Array.isArray(data)) {
      peers = data[0]?.peersList || data.map((p) => p.symbol).filter(Boolean);
    } else {
      peers = data?.peersList || [];
    }
    return JSON.stringify({ peers: peers.slice(0, 5) });
  },
  {
    name: 'get_peers',
    description: 'Get competitor/peer company ticker symbols.',
    schema: z.object({ ticker: z.string() }),
  }
);

export const ALL_TOOLS = [
  searchCompanyTool,
  getProfileTool,
  getIncomeStatementTool,
  getBalanceSheetTool,
  getCashFlowTool,
  getKeyMetricsTool,
  getNewsTool,
  getPeersTool,
];
