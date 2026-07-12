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
 * For Indian exchanges (BSE/NSE), Yahoo Finance works much better
 * with a date string for period1 rather than a Date object.
 * Also, intraday intervals (5m, 1h) are often unavailable for Indian tickers
 * outside market hours — we fall back to '1d' in those cases.
 */
const isIndianTicker = (ticker) => /\.(NS|BO)$/i.test(ticker);

const toDateString = (date) => date.toISOString().split('T')[0]; // "YYYY-MM-DD"

/**
 * GET /api/chart/:ticker?range=1Y
 * Returns historical OHLCV quotes + meta (52w range, currency, current price)
 */
router.get('/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const range = req.query.range || '1Y';
  const cfg = RANGE_MAP[range] || RANGE_MAP['1Y'];

  const period1Date = new Date(Date.now() - cfg.days * 24 * 60 * 60 * 1000);
  const indian = isIndianTicker(ticker);

  // Use a date string for Indian tickers — Yahoo Finance handles BSE/NSE better this way
  const period1 = indian ? toDateString(period1Date) : period1Date;

  // Intraday intervals (5m, 1h) are unreliable for Indian tickers outside market hours.
  // Fall back to '1d' for them.
  const interval = (indian && (cfg.interval === '5m' || cfg.interval === '1h'))
    ? '1d'
    : cfg.interval;

  try {
    console.log(`📈 Chart: fetching ${ticker} range=${range} interval=${interval} period1=${period1}`);

    let raw;
    try {
      raw = await yahooFinance.chart(ticker, { period1, interval });
    } catch (primaryErr) {
      // If the preferred interval fails for Indian tickers, retry with '1d'
      if (indian && interval !== '1d') {
        console.warn(`⚠️ Chart: ${interval} failed for Indian ticker ${ticker}, retrying with 1d...`);
        raw = await yahooFinance.chart(ticker, { period1, interval: '1d' });
      } else {
        throw primaryErr;
      }
    }

    // BSE (.BO) tickers often return very few data points from Yahoo Finance
    // while the same company's NSE (.NS) ticker has full history.
    // If we got ≤3 data points for a .BO ticker, retry with .NS equivalent.
    if (indian && ticker.toUpperCase().endsWith('.BO')) {
      const quotesCount = (raw?.quotes ?? []).filter(q => q.close != null).length;
      if (quotesCount <= 3) {
        const nsTicker = ticker.replace(/\.BO$/i, '.NS');
        console.warn(`⚠️ Chart: Only ${quotesCount} data points for ${ticker} (BSE). Retrying with NSE equivalent: ${nsTicker}`);
        try {
          const nsRaw = await yahooFinance.chart(nsTicker, { period1, interval });
          const nsCount = (nsRaw?.quotes ?? []).filter(q => q.close != null).length;
          if (nsCount > quotesCount) {
            console.log(`✅ Chart: NSE fallback succeeded — ${nsCount} data points for ${nsTicker}`);
            raw = nsRaw;
          }
        } catch (nsErr) {
          console.warn(`⚠️ Chart: NSE fallback also failed for ${nsTicker}: ${nsErr.message}`);
          // Keep the original (sparse) result — better than nothing
        }
      }
    }

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

    console.log(`✅ Chart: ${quotes.length} data points for ${ticker} (${range})`);

    return res.json({
      ticker: ticker.toUpperCase(),
      range,
      interval,
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
