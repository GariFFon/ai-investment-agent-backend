import mongoose from 'mongoose';

const analysisSchema = new mongoose.Schema({
  ticker: { type: String, required: true, uppercase: true },
  companyName: { type: String, required: true },
  fetchedAt: { type: Date, default: Date.now },   // TTL index on this
  verdict: { type: String, enum: ['INVEST', 'PASS', 'HOLD'], required: true },
  confidence: { type: Number, min: 0, max: 100 },
  strengths: [String],
  risks: [String],
  reasoning: { type: String },
  financialSummary: {
    revenue: String,
    revenueGrowth: String,
    netMargin: String,
    grossMargin: String,
    operatingMargin: String,
    peRatio: Number,
    pbRatio: Number,
    evEbitda: Number,
    debtToEquity: Number,
    currentRatio: Number,
    roe: String,
    roce: String,
    freeCashFlow: String,
    marketCap: String,
  },
  industry: String,
  sector: String,
  description: String,
  rawData: { type: mongoose.Schema.Types.Mixed },  // full FMP response cached
});

// Auto-delete documents 30 days after fetchedAt (2592000s = 30 days)
analysisSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 2592000 });

// Unique per ticker (upsert on re-fetch)
analysisSchema.index({ ticker: 1 });

const Analysis = mongoose.model('Analysis', analysisSchema);
export default Analysis;
