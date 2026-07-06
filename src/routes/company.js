import express from 'express';
import Analysis from '../models/Analysis.js';

const router = express.Router();

// GET /api/company/:ticker
router.get('/:ticker', async (req, res) => {
  try {
    const analysis = await Analysis.findOne({
      ticker: req.params.ticker.toUpperCase(),
    }).sort({ fetchedAt: -1 });

    if (!analysis) {
      return res.status(404).json({ error: 'Company not found in cache' });
    }
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
