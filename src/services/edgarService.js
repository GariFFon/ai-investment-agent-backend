import axios from 'axios';

/**
 * SEC EDGAR Data Service
 * Fetches official financial facts directly from the US SEC.
 * No API key required — completely free.
 *
 * Endpoints used:
 *  - https://www.sec.gov/files/company_tickers.json        (ticker → CIK map)
 *  - https://data.sec.gov/api/xbrl/companyfacts/CIK{}.json (all XBRL financial facts)
 *  - https://data.sec.gov/submissions/CIK{}.json           (filings list)
 *
 * SEC Fair Use: We set a descriptive User-Agent as requested by SEC guidelines.
 */

const EDGAR_HEADERS = {
  'User-Agent': 'InvestIQ research@investiq.app',
  'Accept': 'application/json',
};

// In-memory cache for the ticker→CIK map (downloaded once per server lifetime)
let _tickerCikMap = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Pad CIK to 10 digits as SEC requires */
const padCIK = (cik) => String(cik).padStart(10, '0');

/** Pick the most recent annual (10-K) values for a given XBRL concept */
const extractAnnualValues = (facts, conceptName, maxYears = 5) => {
  // Try multiple possible XBRL namespaces
  const namespaces = ['us-gaap', 'dei'];
  for (const ns of namespaces) {
    const concept = facts?.[ns]?.[conceptName];
    if (!concept) continue;

    const usdUnits = concept.units?.USD || concept.units?.shares || concept.units?.pure;
    if (!usdUnits?.length) continue;

    // Filter to 10-K annual filings, deduplicate by fiscal year end
    const seen = new Set();
    return usdUnits
      .filter((entry) => entry.form === '10-K' && entry.end && !seen.has(entry.end) && seen.add(entry.end))
      .sort((a, b) => b.end.localeCompare(a.end)) // newest first
      .slice(0, maxYears)
      .map((entry) => ({ date: entry.end, value: entry.val }));
  }
  return [];
};

/** Try multiple concept names, return first that has data */
const extractBestConcept = (facts, candidates, maxYears = 5) => {
  for (const name of candidates) {
    const result = extractAnnualValues(facts, name, maxYears);
    if (result.length > 0) return result;
  }
  return [];
};

/** Get latest single value from a concept */
const latestValue = (series) => series?.[0]?.value ?? null;

// ── Step 1: Resolve ticker → CIK ─────────────────────────────────────────────

/**
 * Downloads the SEC's full company_tickers.json (all US public companies)
 * and caches it in memory. Then looks up the CIK for a given ticker.
 * Returns null if ticker not found (non-US company, etc.)
 */
export const resolveCIK = async (ticker) => {
  if (!_tickerCikMap) {
    console.log('📚 EDGAR: Downloading company_tickers.json (one-time)...');
    const { data } = await axios.get('https://www.sec.gov/files/company_tickers.json', {
      headers: EDGAR_HEADERS,
      timeout: 10000,
    });
    // data is: { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, ... }
    _tickerCikMap = {};
    for (const entry of Object.values(data)) {
      _tickerCikMap[entry.ticker.toUpperCase()] = {
        cik: entry.cik_str,
        name: entry.title,
      };
    }
    console.log(`📚 EDGAR: Loaded ${Object.keys(_tickerCikMap).length} companies into memory`);
  }

  const normalizedTicker = ticker.toUpperCase().split('.')[0]; // strip .NS, .BO suffixes
  const entry = _tickerCikMap[normalizedTicker];
  if (!entry) {
    console.warn(`📚 EDGAR: No CIK found for ticker "${ticker}" (may be non-US company)`);
    return null;
  }
  console.log(`📚 EDGAR: ${ticker} → CIK ${entry.cik} (${entry.name})`);
  return entry.cik;
};

// ── Step 2: Fetch company financial facts ─────────────────────────────────────

/**
 * Fetches the full XBRL companyfacts JSON from EDGAR and extracts
 * key financial data points across multiple years.
 */
export const fetchEdgarFacts = async (cik) => {
  const paddedCik = padCIK(cik);
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;

  console.log(`📚 EDGAR: Fetching companyfacts for CIK ${paddedCik}...`);
  const { data } = await axios.get(url, {
    headers: EDGAR_HEADERS,
    timeout: 20000,
  });

  const facts = data.facts;
  const entityName = data.entityName;

  // ── Revenue (try multiple XBRL concept names — companies use different ones) ──
  const revenueHistory = extractBestConcept(facts, [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
    'SalesRevenueGoodsNet',
    'RevenuesNetOfInterestExpense',
  ]);

  // ── Net Income ──────────────────────────────────────────────────────────────
  const netIncomeHistory = extractBestConcept(facts, [
    'NetIncomeLoss',
    'NetIncomeLossAvailableToCommonStockholdersBasic',
    'ProfitLoss',
  ]);

  // ── EPS Diluted ─────────────────────────────────────────────────────────────
  const epsDilutedHistory = extractBestConcept(facts, [
    'EarningsPerShareDiluted',
    'EarningsPerShareBasic',
  ]);

  // ── R&D Expense ─────────────────────────────────────────────────────────────
  const rdHistory = extractBestConcept(facts, [
    'ResearchAndDevelopmentExpense',
    'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost',
  ]);

  // ── Operating Cash Flow ─────────────────────────────────────────────────────
  const operatingCFHistory = extractBestConcept(facts, [
    'NetCashProvidedByUsedInOperatingActivities',
  ]);

  // ── Total Assets ────────────────────────────────────────────────────────────
  const assetsHistory = extractBestConcept(facts, ['Assets']);

  // ── Total Liabilities ───────────────────────────────────────────────────────
  const liabilitiesHistory = extractBestConcept(facts, [
    'Liabilities',
    'LiabilitiesAndStockholdersEquity',
  ]);

  // ── Shares Outstanding ──────────────────────────────────────────────────────
  const sharesHistory = extractBestConcept(facts, [
    'CommonStockSharesOutstanding',
    'EntityCommonStockSharesOutstanding',
  ]);

  // ── Dividends Per Share ─────────────────────────────────────────────────────
  const dividendHistory = extractBestConcept(facts, [
    'CommonStockDividendsPerShareDeclared',
    'CommonStockDividendsPerShareCashPaid',
  ]);

  // ── Gross Profit ────────────────────────────────────────────────────────────
  const grossProfitHistory = extractBestConcept(facts, ['GrossProfit']);

  // ── Operating Income ────────────────────────────────────────────────────────
  const operatingIncomeHistory = extractBestConcept(facts, [
    'OperatingIncomeLoss',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
  ]);

  return {
    entityName,
    revenueHistory,
    netIncomeHistory,
    epsDilutedHistory,
    rdHistory,
    operatingCFHistory,
    assetsHistory,
    liabilitiesHistory,
    sharesHistory,
    dividendHistory,
    grossProfitHistory,
    operatingIncomeHistory,
    // Convenient latest-year snapshots
    latestRevenue:       latestValue(revenueHistory),
    latestNetIncome:     latestValue(netIncomeHistory),
    latestEpsDiluted:    latestValue(epsDilutedHistory),
    latestRD:            latestValue(rdHistory),
    latestOperatingCF:   latestValue(operatingCFHistory),
    latestAssets:        latestValue(assetsHistory),
    latestLiabilities:   latestValue(liabilitiesHistory),
    latestShares:        latestValue(sharesHistory),
    latestDividendPerShare: latestValue(dividendHistory),
    latestGrossProfit:   latestValue(grossProfitHistory),
    latestOperatingIncome: latestValue(operatingIncomeHistory),
  };
};

// ── Step 3: Fetch recent filings ──────────────────────────────────────────────

/**
 * Fetches the submissions endpoint and extracts links to latest 10-K, 10-Q, 8-Ks.
 */
export const fetchEdgarFilings = async (cik) => {
  const paddedCik = padCIK(cik);
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;

  console.log(`📚 EDGAR: Fetching filings for CIK ${paddedCik}...`);
  const { data } = await axios.get(url, {
    headers: EDGAR_HEADERS,
    timeout: 15000,
  });

  const filings = data.filings?.recent || {};
  const forms        = filings.form        || [];
  const dates        = filings.filingDate  || [];
  const accessions   = filings.accessionNumber || [];
  const primaryDocs  = filings.primaryDocument || [];

  const buildFilingUrl = (accession, doc) => {
    const acc = accession.replace(/-/g, '');
    return `https://www.sec.gov/Archives/edgar/full-index/${paddedCik}/${acc}/${doc}`;
  };

  const findFiling = (formType) => {
    const idx = forms.findIndex((f) => f === formType);
    if (idx === -1) return null;
    return {
      form: forms[idx],
      date: dates[idx],
      accession: accessions[idx],
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=${formType}&dateb=&owner=include&count=10`,
    };
  };

  // Collect all recent 8-Ks (last 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent8Ks = forms.reduce((acc, form, idx) => {
    if (form === '8-K' && dates[idx] >= ninetyDaysAgo) {
      acc.push({ date: dates[idx], accession: accessions[idx] });
    }
    return acc;
  }, []).slice(0, 5);

  return {
    latest10K: findFiling('10-K'),
    latest10Q: findFiling('10-Q'),
    recent8Ks,
    edgarPageUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${paddedCik}&type=&dateb=&owner=include&count=40`,
  };
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Main entry point: ticker → all EDGAR data.
 * Returns null gracefully if the company is not found in SEC's database.
 */
export const fetchEdgarData = async (ticker) => {
  try {
    const cik = await resolveCIK(ticker);
    if (!cik) return null; // Non-US company — skip silently

    // Fetch facts and filings in parallel
    const [facts, filings] = await Promise.all([
      fetchEdgarFacts(cik).catch((err) => {
        console.warn(`📚 EDGAR: Facts fetch failed for CIK ${cik}: ${err.message}`);
        return null;
      }),
      fetchEdgarFilings(cik).catch((err) => {
        console.warn(`📚 EDGAR: Filings fetch failed for CIK ${cik}: ${err.message}`);
        return null;
      }),
    ]);

    console.log(`✅ EDGAR: Data fetched for ${ticker} (CIK: ${cik})`);

    return {
      source: 'sec-edgar',
      ticker,
      cik,
      facts: facts ?? null,
      filings: filings ?? null,
    };
  } catch (err) {
    console.warn(`⚠️ EDGAR: Fetch failed for ${ticker}: ${err.message}`);
    return null;
  }
};
