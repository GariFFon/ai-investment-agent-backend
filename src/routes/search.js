import express from 'express';
import axios from 'axios';

const router = express.Router();

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const key = () => process.env.FMP_API_KEY;

/**
 * Search Yahoo Finance for global stocks (covers NSE/BSE Indian stocks too).
 * Returns results as a normalized shape matching FMP results.
 */
const searchYahooGlobal = async (q) => {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&newsCount=0&quotesCount=20&enableFuzzyQuery=true`;
  try {
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
      .map((q) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        currency: q.currency || '',
        exchangeFullName: q.exchDisp || q.exchange || '',
        exchange: q.exchange || '',
        // Tag Indian stocks for easy frontend display
        country: /\.(NS|BO)$/i.test(q.symbol) ? 'India' : (q.country || ''),
      }));
  } catch (err) {
    console.warn(`⚠️ Yahoo Finance search failed: ${err.message}`);
    return [];
  }
};

/**
 * GET /api/search?q=Reliance
 * Returns all matching companies from FMP + Yahoo Finance (merged, deduplicated).
 * Each result includes: symbol, name, currency, exchangeFullName, exchange, country.
 *
 * Indian stocks (NSE/BSE) now appear thanks to Yahoo Finance supplementing FMP.
 */
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    // Run FMP and Yahoo searches in parallel
    const [fmpByName, fmpBySymbol, yahooResults] = await Promise.allSettled([
      axios.get(`${FMP_BASE}/search-name?query=${encodeURIComponent(q)}&limit=20&apikey=${key()}`),
      axios.get(`${FMP_BASE}/search-symbol?query=${encodeURIComponent(q)}&limit=20&apikey=${key()}`),
      searchYahooGlobal(q),
    ]);

    const nameResults   = fmpByName.status   === 'fulfilled' ? (fmpByName.value.data   || []) : [];
    const symbolResults = fmpBySymbol.status === 'fulfilled' ? (fmpBySymbol.value.data || []) : [];
    const yahooData     = yahooResults.status === 'fulfilled' ? yahooResults.value : [];

    // Normalize FMP results
    const fmpResults = [...nameResults, ...symbolResults].map((r) => ({
      symbol:           r.symbol,
      name:             r.name || r.companyName || '',
      currency:         r.currency || '',
      exchangeFullName: r.exchangeFullName || r.exchange || '',
      exchange:         r.exchange || '',
      country:          r.country || '',
    }));

    // Merge all results, deduplicate by symbol
    // Priority order: FMP first (more detailed for US), then Yahoo (global coverage)
    const seen = new Set();
    const merged = [...fmpResults, ...yahooData].filter((r) => {
      if (!r.symbol || seen.has(r.symbol)) return false;
      seen.add(r.symbol);
      return true;
    });

    // Sort: Indian stocks (.NS/.BO) and major US exchanges first
    const INDIAN_EXCHANGES = ['NSE', 'BSE', 'NMS', 'BOM'];
    const US_EXCHANGES = ['NASDAQ', 'NYSE', 'NYSE ARCA', 'NMS'];

    merged.sort((a, b) => {
      const aIsIndian = /\.(NS|BO)$/i.test(a.symbol) || INDIAN_EXCHANGES.includes(a.exchange);
      const bIsIndian = /\.(NS|BO)$/i.test(b.symbol) || INDIAN_EXCHANGES.includes(b.exchange);
      const aIsUS = US_EXCHANGES.includes(a.exchange);
      const bIsUS = US_EXCHANGES.includes(b.exchange);

      // If query looks like an Indian company name, prioritize Indian results
      // Otherwise keep original order (FMP US results first)
      if (aIsIndian && !bIsIndian) return -1;
      if (!aIsIndian && bIsIndian) return 1;
      if (aIsUS && !bIsUS) return -1;
      if (!aIsUS && bIsUS) return 1;
      return 0;
    });

    res.json(merged);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
