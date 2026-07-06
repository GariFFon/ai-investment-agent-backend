import express from 'express';
import axios from 'axios';

const router = express.Router();

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const key = () => process.env.FMP_API_KEY;

/**
 * GET /api/search?q=Reliance
 * Returns all matching companies from FMP (name + symbol search merged)
 * Each result includes: symbol, name, currency, exchangeFullName, exchange
 */
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    const [byName, bySymbol] = await Promise.allSettled([
      axios.get(`${FMP_BASE}/search-name?query=${encodeURIComponent(q)}&limit=30&apikey=${key()}`),
      axios.get(`${FMP_BASE}/search-symbol?query=${encodeURIComponent(q)}&limit=30&apikey=${key()}`),
    ]);

    const nameResults = byName.status === 'fulfilled' ? byName.value.data || [] : [];
    const symbolResults = bySymbol.status === 'fulfilled' ? bySymbol.value.data || [] : [];

    // Merge and deduplicate by symbol
    const seen = new Set();
    const merged = [...nameResults, ...symbolResults].filter((r) => {
      if (!r.symbol || seen.has(r.symbol)) return false;
      seen.add(r.symbol);
      return true;
    });

    // Map to consistent shape
    const results = merged.map((r) => ({
      symbol: r.symbol,
      name: r.name || r.companyName || '',
      currency: r.currency || '',
      exchangeFullName: r.exchangeFullName || r.exchange || '',
      exchange: r.exchange || '',
    }));

    res.json(results);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;
