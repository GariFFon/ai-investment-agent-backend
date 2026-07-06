import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import connectDB from './db/connect.js';
import analyzeRouter from './routes/analyze.js';
import historyRouter from './routes/history.js';
import companyRouter from './routes/company.js';
import searchRouter from './routes/search.js';

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/analyze', analyzeRouter);
app.use('/api/history', historyRouter);
app.use('/api/company', companyRouter);
app.use('/api/search', searchRouter);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Start ──────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
