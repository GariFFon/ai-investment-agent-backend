import axios from 'axios';
import * as cheerio from 'cheerio';

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
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.screener.in/',
};

/* ─────────────────────────────────────────────────────────────────────────────
   Step 1: Search Screener.in for a symbol to get the correct company slug.
   The search API (/api/company/search/) still works.
───────────────────────────────────────────────────────────────────────────── */
const resolveScreenerSlug = async (symbol) => {
  const searchUrl = `${SCREENER_BASE}/api/company/search/?q=${encodeURIComponent(symbol)}`;
  console.log(`🔎 Screener.in search: ${searchUrl}`);
  try {
    const { data } = await axios.get(searchUrl, {
      headers: { ...SCREENER_HEADERS, Accept: 'application/json' },
      timeout: 10000,
    });
    if (!Array.isArray(data) || data.length === 0) return { slug: symbol, consolidated: false };

    const extractSlug = (url) =>
      url?.replace(/^\/company\//, '').split('/')[0]?.toUpperCase() || null;

    const isConsolidated = (url) => url?.includes('/consolidated/');

    // Priority 1: exact slug match
    const exactMatch = data.find(
      (r) => extractSlug(r.url) === symbol.toUpperCase()
    );
    const best = exactMatch || data[0];
    const slug = extractSlug(best.url) || symbol;
    const consolidated = isConsolidated(best.url);

    console.log(`✅ Screener.in resolved slug: "${symbol}" → "${slug}" (consolidated: ${consolidated}, from "${best.name}")`);
    return { slug, consolidated };
  } catch (err) {
    console.warn(`⚠️ Screener.in search failed for ${symbol}: ${err.message}. Using raw symbol.`);
    return { slug: symbol, consolidated: false };
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   Step 2: Fetch the HTML company page (NOT /api/ — that's dead).
   Tries /company/{slug}/consolidated/ first, falls back to /company/{slug}/
───────────────────────────────────────────────────────────────────────────── */
const fetchScreenerHTML = async (slug, preferConsolidated = true) => {
  const urls = preferConsolidated
    ? [
        `${SCREENER_BASE}/company/${encodeURIComponent(slug)}/consolidated/`,
        `${SCREENER_BASE}/company/${encodeURIComponent(slug)}/`,
      ]
    : [
        `${SCREENER_BASE}/company/${encodeURIComponent(slug)}/`,
        `${SCREENER_BASE}/company/${encodeURIComponent(slug)}/consolidated/`,
      ];

  for (const url of urls) {
    console.log(`📡 Screener.in GET (HTML): ${url}`);
    try {
      const { data, status } = await axios.get(url, {
        headers: SCREENER_HEADERS,
        timeout: 20000,
      });
      if (status === 200 && typeof data === 'string' && data.includes('id="top-ratios"')) {
        return data;
      }
    } catch (err) {
      if (err.response?.status === 404) {
        console.warn(`⚠️ Screener.in: ${url} returned 404, trying next...`);
        continue;
      }
      throw err;
    }
  }
  return null;
};

/* ─────────────────────────────────────────────────────────────────────────────
   HTML Parsing Helpers
───────────────────────────────────────────────────────────────────────────── */

/** Parse an Indian-formatted number string like "1,23,456.78" → 123456.78 */
const parseIndianNum = (text) => {
  if (text == null) return null;
  const cleaned = String(text).replace(/,/g, '').replace(/₹/g, '').trim();
  if (cleaned === '' || cleaned === '—' || cleaned === '-') return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
};

/** Convert Screener.in Cr (crore) values to absolute numbers. 1 Crore = 10,000,000 */
const crToAbs = (val) => (val != null && !isNaN(val) ? val * 1e7 : null);

/**
 * Parse a Screener.in data table by its section ID.
 * Returns { headers: string[], rows: { name, values: number[] }[] }
 */
const parseDataTable = ($, sectionId) => {
  const section = $(`#${sectionId}`).closest('section');
  if (!section.length) return { headers: [], rows: [] };

  const table = section.find('table.data-table').first();
  if (!table.length) return { headers: [], rows: [] };

  // Parse headers (year labels)
  const headers = [];
  table.find('thead th').each((i, el) => {
    const text = $(el).text().trim();
    if (text && i > 0) headers.push(text); // skip first empty header cell
  });

  // Parse data rows
  const rows = [];
  table.find('tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 2) return;

    const name = $(tds[0]).text().replace(/[+\s]+$/g, '').trim();
    const values = [];
    tds.slice(1).each((_, td) => {
      values.push(parseIndianNum($(td).text()));
    });
    if (name) rows.push({ name, values });
  });

  return { headers, rows };
};

/**
 * Find a row by partial name match (case-insensitive)
 */
const findRow = (rows, name) =>
  rows.find((r) => r.name.toLowerCase().includes(name.toLowerCase()));

/* ─────────────────────────────────────────────────────────────────────────────
   Step 3: Parse all data sections from HTML
───────────────────────────────────────────────────────────────────────────── */
const parseScreenerHTML = ($, ticker) => {
  // ── 1. Top Ratios (key-value list) ──────────────────────────────────────
  const topRatios = {};
  $('#top-ratios li, [id="top-ratios"] li').each((_, li) => {
    const name = $(li).find('.name').text().trim();
    const valueText = $(li).find('.value .number').map((_, el) => $(el).text().trim()).get();
    if (name && valueText.length > 0) {
      topRatios[name] = parseIndianNum(valueText[0]);
      // For "High / Low", store both values
      if (name === 'High / Low' && valueText.length >= 2) {
        topRatios['52W High'] = parseIndianNum(valueText[0]);
        topRatios['52W Low'] = parseIndianNum(valueText[1]);
      }
    }
  });
  console.log(`   📊 Top ratios parsed: ${Object.keys(topRatios).length} items`);

  // ── 2. Company Info ──────────────────────────────────────────────────────
  const companyName = $('h1').first().text().trim() || null;
  const description = $('.company-description .about p, .company-profile .about p').first().text().trim() || null;

  const companyProfile = {
    name: companyName,
    ticker,
    exchange: ticker.endsWith('.BO') ? 'BSE' : 'NSE',
    sector: null,
    industry: null,
    description,
    website: null,
    marketCap: crToAbs(topRatios['Market Cap']),
    price: topRatios['Current Price'],
    country: 'India',
    employees: null,
    ceo: null,
    ipoDate: null,
    beta: null,
    currency: 'INR',
  };

  // Try to extract sector/industry from breadcrumbs or company info section
  const companyInfo = $('#company-info').closest('section');
  if (companyInfo.length) {
    const links = companyInfo.find('a');
    links.each((_, a) => {
      const href = $(a).attr('href') || '';
      const text = $(a).text().trim();
      if (href.includes('/sector/')) companyProfile.sector = text;
      if (href.includes('/industry/')) companyProfile.industry = text;
    });
  }

  // ── 3. Annual Income Statement (Profit & Loss) ─────────────────────────
  const pl = parseDataTable($, 'profit-loss');
  const incomeStatement = pl.headers.map((year, i) => {
    const getVal = (name) => findRow(pl.rows, name)?.values[i] ?? null;
    const sales = getVal('Sales');
    const opProfit = getVal('Operating Profit');
    const netProfit = getVal('Net Profit');
    const opm = getVal('OPM');
    const eps = getVal('EPS');

    return {
      year,
      revenue: crToAbs(sales),
      grossProfit: null,
      grossMargin: null,
      operatingIncome: crToAbs(opProfit),
      operatingMargin: opm != null ? opm / 100 : null,
      netIncome: crToAbs(netProfit),
      netMargin: sales && netProfit ? netProfit / sales : null,
      eps: eps,
      ebitda: crToAbs(opProfit), // Screener uses OP as proxy
    };
  }).slice(-5); // last 5 years
  console.log(`   📈 Income statement: ${incomeStatement.length} years`);

  // ── 4. Balance Sheet ───────────────────────────────────────────────────
  const bs = parseDataTable($, 'balance-sheet');
  const balanceSheet = bs.headers.map((year, i) => {
    const getVal = (name) => findRow(bs.rows, name)?.values[i] ?? null;
    return {
      year,
      totalAssets: crToAbs(getVal('Total Assets') ?? getVal('Balance Sheet Total')),
      totalDebt: crToAbs(getVal('Borrowings') ?? getVal('Total Debt')),
      totalEquity: crToAbs(getVal('Total Equity') ?? getVal("Shareholders' Funds") ?? getVal('Share Capital')),
      totalLiabilities: crToAbs(getVal('Total Liabilities')),
      cash: crToAbs(getVal('Cash Equivalents') ?? getVal('Cash & Bank')),
      currentRatio: null,
    };
  }).slice(-5);
  console.log(`   🏦 Balance sheet: ${balanceSheet.length} years`);

  // ── 5. Cash Flow ──────────────────────────────────────────────────────
  const cf = parseDataTable($, 'cash-flow');
  const cashFlow = cf.headers.map((year, i) => {
    const getVal = (name) => findRow(cf.rows, name)?.values[i] ?? null;
    const opCF = getVal('Cash from Operating Activity') ?? getVal('Operating Cash Flow');
    const capex = getVal('Capital Expenditure') ?? getVal('CAPEX') ?? getVal('Fixed Assets Purchased');
    return {
      year,
      operatingCashFlow: crToAbs(opCF),
      capitalExpenditure: crToAbs(capex),
      freeCashFlow: opCF != null && capex != null ? crToAbs(opCF + capex) : null,
      dividendsPaid: crToAbs(getVal('Dividends Paid')),
    };
  }).slice(-5);
  console.log(`   💸 Cash flow: ${cashFlow.length} years`);

  // ── 6. Key Ratios Table (multi-year) ──────────────────────────────────
  const ratiosTable = parseDataTable($, 'ratios');
  const ratiosList = ratiosTable.rows.map((row) => ({
    name: row.name,
    values: ratiosTable.headers.map((year, i) => ({
      year,
      value: row.values[i],
    })),
  }));

  // Build keyMetrics from topRatios + ratios table
  const findRatioLatest = (name) => {
    const row = findRow(ratiosTable.rows, name);
    if (!row) return null;
    // Return the last non-null value
    for (let i = row.values.length - 1; i >= 0; i--) {
      if (row.values[i] != null) return row.values[i];
    }
    return null;
  };

  const keyMetrics = {
    peRatio: topRatios['Stock P/E'] ?? topRatios['P/E'] ?? findRatioLatest('P/E'),
    pbRatio: topRatios['Book Value'] && topRatios['Current Price']
      ? +(topRatios['Current Price'] / topRatios['Book Value']).toFixed(2)
      : findRatioLatest('Price to Book'),
    priceToSales: findRatioLatest('Price to Sales') ?? findRatioLatest('P/S'),
    evToEbitda: findRatioLatest('EV / EBITDA'),
    roe: topRatios['ROE'] != null ? topRatios['ROE'] / 100 : (findRatioLatest('Return on Equity') != null ? findRatioLatest('Return on Equity') / 100 : null),
    roa: null,
    returnOnInvestedCapital: topRatios['ROCE'] != null ? topRatios['ROCE'] / 100 : (findRatioLatest('ROCE') != null ? findRatioLatest('ROCE') / 100 : null),
    returnOnCapitalEmployed: topRatios['ROCE'] != null ? topRatios['ROCE'] / 100 : (findRatioLatest('ROCE') != null ? findRatioLatest('ROCE') / 100 : null),
    debtToEquity: findRatioLatest('Debt to equity') ?? findRatioLatest('Debt to Equity'),
    currentRatio: findRatioLatest('Current ratio') ?? findRatioLatest('Current Ratio'),
    dividendYield: topRatios['Dividend Yield'] != null ? topRatios['Dividend Yield'] / 100 : (findRatioLatest('Dividend Yield') != null ? findRatioLatest('Dividend Yield') / 100 : null),
    payoutRatio: findRatioLatest('Payout ratio') != null ? findRatioLatest('Payout ratio') / 100 : null,
    quickRatio: null,
    interestCoverage: findRatioLatest('Interest Coverage'),
    netDebtToEBITDA: null,
  };

  // ── 7. Quarterly Results ───────────────────────────────────────────────
  const qr = parseDataTable($, 'quarters');
  const quarterlyResults = qr.headers.map((quarter, i) => {
    const getVal = (name) => findRow(qr.rows, name)?.values[i] ?? null;
    return {
      quarter,
      revenue: crToAbs(getVal('Sales')),
      operatingProfit: crToAbs(getVal('Operating Profit')),
      netProfit: crToAbs(getVal('Net Profit')),
      opmPercent: getVal('OPM'),
      eps: getVal('EPS'),
    };
  }).slice(-8); // last 8 quarters
  console.log(`   📅 Quarterly results: ${quarterlyResults.length} quarters`);

  // ── 8. Shareholding Pattern ────────────────────────────────────────────
  let shareholding = null;
  const shpSection = $('#shareholding').closest('section');
  if (shpSection.length) {
    const shpTable = shpSection.find('table.data-table').first();
    if (shpTable.length) {
      const shpHeaders = [];
      shpTable.find('thead th').each((i, el) => {
        const text = $(el).text().trim();
        if (text && i > 0) shpHeaders.push(text);
      });

      const shpRows = [];
      shpTable.find('tbody tr').each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length < 2) return;
        const name = $(tds[0]).text().trim();
        const values = [];
        tds.slice(1).each((_, td) => {
          values.push(parseIndianNum($(td).text()));
        });
        if (name) shpRows.push({ name, values });
      });

      // Get the latest values (last column)
      const latest = (name) => {
        const row = shpRows.find((r) => r.name.toLowerCase().includes(name.toLowerCase()));
        return row?.values[row.values.length - 1] ?? null;
      };

      shareholding = {
        promoter: latest('Promoter'),
        fii: latest('FII') ?? latest('Foreign'),
        dii: latest('DII') ?? latest('Domestic'),
        public: latest('Public') ?? latest('Others'),
        government: latest('Government'),
        latestQuarter: shpHeaders[shpHeaders.length - 1] || null,
        trend: shpHeaders.map((quarter, i) => ({
          quarter,
          promoter: shpRows.find((r) => r.name.toLowerCase().includes('promoter'))?.values[i] ?? null,
          fii: (shpRows.find((r) => r.name.toLowerCase().includes('fii')) ?? shpRows.find((r) => r.name.toLowerCase().includes('foreign')))?.values[i] ?? null,
          dii: (shpRows.find((r) => r.name.toLowerCase().includes('dii')) ?? shpRows.find((r) => r.name.toLowerCase().includes('domestic')))?.values[i] ?? null,
          public: (shpRows.find((r) => r.name.toLowerCase().includes('public')) ?? shpRows.find((r) => r.name.toLowerCase().includes('others')))?.values[i] ?? null,
        })).slice(-4),
      };
      console.log(`   🏛️ Shareholding: Promoter ${shareholding.promoter}%, FII ${shareholding.fii}%`);
    }
  }

  // ── 9. Peer Companies ──────────────────────────────────────────────────
  const peers = [];
  const peersSection = $('#peers').closest('section');
  if (peersSection.length) {
    peersSection.find('table a[href*="/company/"]').each((_, a) => {
      const href = $(a).attr('href') || '';
      const peerSlug = href.replace(/^\/company\//, '').split('/')[0];
      if (peerSlug && peerSlug.toUpperCase() !== toScreenerSymbol(ticker)) {
        peers.push(peerSlug.toUpperCase());
      }
    });
  }
  console.log(`   👥 Peers: ${peers.length} found`);

  return {
    companyProfile,
    incomeStatement,
    balanceSheet,
    cashFlow,
    keyMetrics,
    shareholding,
    quarterlyResults,
    ratiosList,
    peers: [...new Set(peers)].slice(0, 8),
    topRatios, // raw top ratios for debugging / extra data
  };
};

/* ─────────────────────────────────────────────────────────────────────────────
   Main export: Fetch and parse Screener.in data for an Indian company
───────────────────────────────────────────────────────────────────────────── */
export const fetchScreenerData = async (ticker) => {
  const symbol = toScreenerSymbol(ticker);
  console.log(`🇮🇳 Screener.in: Fetching data for ${symbol} (from ${ticker})...`);

  // Step 1: Resolve the correct Screener.in slug
  const { slug, consolidated } = await resolveScreenerSlug(symbol);

  // Step 2: Fetch the HTML page
  let html;
  try {
    html = await fetchScreenerHTML(slug, consolidated);
  } catch (err) {
    console.warn(`⚠️ Screener.in HTML fetch failed for ${slug}: ${err.message}`);
    return null;
  }

  if (!html) {
    console.warn(`⚠️ Screener.in: No valid HTML page found for ${symbol}`);
    return null;
  }

  // Step 3: Parse with cheerio
  const $ = cheerio.load(html);
  const parsed = parseScreenerHTML($, ticker);

  console.log(`✅ Screener.in data fetched for ${symbol} (HTML scraping)`);

  return {
    source: 'screener.in',
    symbol,
    ticker,
    ...parsed,
    recentNews: [],
    currency: 'INR',
  };
};
