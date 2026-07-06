import express from 'express';
import Analysis from '../models/Analysis.js';
import { runAnalysisAgent } from '../agent/graph.js';

const router = express.Router();

/**
 * POST /api/analyze
 * Body: { companyName: "Apple" }
 *
 * Flow:
 *  1. Check MongoDB cache
 *  2. If fresh cache (<24h) → return it instantly
 *  3. Else → run agent → save to MongoDB → return
 */
router.post('/', async (req, res) => {
  const { companyName, ticker: preferredTicker } = req.body;

  if (!companyName?.trim()) {
    return res.status(400).json({ error: 'companyName is required' });
  }

  try {
    // ── Step 1: Check cache ──────────────────────────────────────────────────
    // If user selected a specific ticker (e.g. "NVDA"), match by exact ticker
    // to avoid returning a stale result for a different exchange (e.g. "NVD.DE").
    const cacheQuery = preferredTicker
      ? { ticker: preferredTicker.toUpperCase() }
      : { companyName: { $regex: new RegExp(companyName.trim(), 'i') } };

    const cached = await Analysis.findOne(cacheQuery).sort({ fetchedAt: -1 });

    if (cached) {
      console.log(`📦 Cache HIT for "${companyName}" (${cached.ticker})`);
      return res.json({
        ...cached.toObject(),
        cached: true,
        cachedAt: cached.fetchedAt,
      });
    }

    // ── Step 2: Run agent ────────────────────────────────────────────────────
    console.log(`🤖 Running agent for "${companyName}" (ticker hint: ${preferredTicker || 'none'})...`);
    const analysis = await runAnalysisAgent(companyName.trim(), preferredTicker || null);

    // ── Step 3: Save to MongoDB ──────────────────────────────────────────────
    const saved = await Analysis.findOneAndUpdate(
      { ticker: analysis.ticker },
      {
        ...analysis,
        fetchedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Saved analysis for ${analysis.ticker}`);

    return res.json({ ...saved.toObject(), cached: false });
  } catch (err) {
    console.error('Agent error:', err);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

export default router;
