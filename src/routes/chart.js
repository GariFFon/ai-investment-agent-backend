import express from 'express';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const router = express.Router();

/* ── Range → Yahoo Finance params ───────────────────────────────────────── */
const RANGE_MAP = {
  '1D':  { days: 1,    interval: '5m'  },
  '1W':  { days: 7,    interval: '1h'  },
  '1M':  { days: 30,   interval: '1d'  },
  '3M':  { days: 90,   interval: '1d'  },
  '6M':  { days: 180,  interval: '1d'  },
  '1Y':  { days: 365,  interval: '1d'  },
  '5Y':  { days: 1825, interval: '1wk' },
};

/**
 * GET /api/chart/:ticker?range=1Y
 * Returns historical OHLCV quotes + meta (52w range, currency, current price)
 */
router.get('/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const range = req.query.range || '1Y';
  const cfg = RANGE_MAP[range] || RANGE_MAP['1Y'];

  const period1 = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000);

  try {
    console.log(`📈 Chart: fetching ${ticker} range=${range} interval=${cfg.interval}`);

    const raw = await yahooFinance.chart(ticker, {
      period1,
      interval: cfg.interval,
    });

    if (!raw || !raw.quotes) {
      return res.status(404).json({ error: 'No price data available for this ticker.' });
    }

    // Normalize quotes — filter out incomplete candles
    const quotes = raw.quotes
      .filter((q) => q.close != null)
      .map((q) => ({
        date:   new Date(q.date).getTime(),
        open:   q.open   != null ? +q.open.toFixed(4)   : null,
        high:   q.high   != null ? +q.high.toFixed(4)   : null,
        low:    q.low    != null ? +q.low.toFixed(4)    : null,
        close:  +q.close.toFixed(4),
        volume: q.volume ?? 0,
      }));

    const meta = raw.meta ?? {};

    return res.json({
      ticker: ticker.toUpperCase(),
      range,
      interval: cfg.interval,
      quotes,
      meta: {
        currency:              meta.currency,
        currentPrice:          meta.regularMarketPrice,
        previousClose:         meta.chartPreviousClose ?? meta.previousClose,
        fiftyTwoWeekHigh:      meta.fiftyTwoWeekHigh,
        fiftyTwoWeekLow:       meta.fiftyTwoWeekLow,
        regularMarketVolume:   meta.regularMarketVolume,
        exchangeName:          meta.exchangeName,
        fullExchangeName:      meta.fullExchangeName,
        instrumentType:        meta.instrumentType,
      },
    });
  } catch (err) {
    console.error(`❌ Chart error for ${ticker}:`, err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch price data' });
  }
});

export default router;
