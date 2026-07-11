import express from 'express';
import axios from 'axios';

const router = express.Router();

// Simple in-memory cache for news (5-minute TTL)
let newsCache = null;
let newsCacheAt = 0;
const NEWS_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch market news via Yahoo Finance RSS (no API key needed).
 * Falls back to a curated set of topics.
 */
async function fetchYahooNews() {
  const feeds = [
    {
      url: 'https://finance.yahoo.com/rss/headline?s=%5EGSPC',
      topic: 'S&P 500',
    },
    {
      url: 'https://finance.yahoo.com/rss/headline?s=%5EIXIC',
      topic: 'NASDAQ',
    },
    {
      url: 'https://finance.yahoo.com/rss/headline?s=BTC-USD',
      topic: 'Bitcoin',
    },
    {
      url: 'https://finance.yahoo.com/rss/2.0/headline?s=AAPL,MSFT,NVDA,TSLA,GOOGL&region=US&lang=en-US',
      topic: 'Top Stocks',
    },
  ];

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/rss+xml, application/xml, text/xml, */*',
  };

  const results = [];

  for (const feed of feeds) {
    try {
      const resp = await axios.get(feed.url, { headers, timeout: 8000 });
      const xml = resp.data;

      // Parse <item> blocks from RSS XML
      const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

      for (const item of itemMatches.slice(0, 6)) {
        const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
          item.match(/<title>(.*?)<\/title>/))?.[1]?.trim();
        const link = (item.match(/<link>(.*?)<\/link>/) ||
          item.match(/<guid[^>]*>(.*?)<\/guid>/))?.[1]?.trim();
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim();
        const description = (
          item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
          item.match(/<description>(.*?)<\/description>/)
        )?.[1]
          ?.replace(/<[^>]*>/g, '')
          ?.trim()
          ?.slice(0, 200);

        if (title && link) {
          results.push({
            title,
            link,
            pubDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            description: description || '',
            source: 'Yahoo Finance',
            topic: feed.topic,
          });
        }
      }
    } catch {
      // Skip this feed on error
    }
  }

  // De-duplicate by link and sort by pubDate descending
  const seen = new Set();
  const unique = results.filter((n) => {
    if (seen.has(n.link)) return false;
    seen.add(n.link);
    return true;
  });

  unique.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return unique.slice(0, 30);
}

// GET /api/news
router.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (newsCache && now - newsCacheAt < NEWS_TTL_MS) {
      return res.json({ news: newsCache, cached: true, fetchedAt: new Date(newsCacheAt).toISOString() });
    }

    const news = await fetchYahooNews();
    newsCache = news;
    newsCacheAt = Date.now();

    return res.json({ news, cached: false, fetchedAt: new Date(newsCacheAt).toISOString() });
  } catch (err) {
    console.error('[news] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch news' });
  }
});

export default router;
