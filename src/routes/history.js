import express from 'express';
import Analysis from '../models/Analysis.js';

const router = express.Router();

// GET /api/history — return last 20 analyses
router.get('/', async (req, res) => {
  try {
    const history = await Analysis.find({})
      .sort({ fetchedAt: -1 })
      .limit(20)
      .select('ticker companyName verdict confidence sector fetchedAt');
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
