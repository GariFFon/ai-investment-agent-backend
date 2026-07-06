import { GoogleGenerativeAI } from '@google/generative-ai';
import { gatherCompanyData } from '../services/fmpService.js';
import { ANALYST_PROMPT } from '../prompts/analyst.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Run investment analysis for a given company name.
 * Architecture:
 *   1. Fetch ALL financial data from FMP APIs in parallel (no LLM involved)
 *   2. Bundle the data into a single prompt
 *   3. Call Gemini ONCE to produce the analysis JSON
 */
export const runAnalysisAgent = async (companyName, preferredTicker = null) => {
  // ── Step 1: Gather all data from FMP (parallel, no Gemini involved) ──────────
  const data = await gatherCompanyData(companyName, preferredTicker);

  // ── Step 2: Build a single rich prompt with all data embedded ────────────────
  // Build Yahoo Finance supplemental section
  const yahooSection = data.yahooData ? `
## Analyst Consensus (Yahoo Finance)
- Recommendation: ${data.yahooData.currentFinancials?.recommendationKey?.toUpperCase() ?? 'N/A'} (mean score: ${data.yahooData.currentFinancials?.recommendationMean ?? 'N/A'}/5, where 1=Strong Buy, 5=Sell)
- Number of analysts: ${data.yahooData.currentFinancials?.numberOfAnalystOpinions ?? 'N/A'}
- Price target (mean): $${data.yahooData.currentFinancials?.targetMeanPrice ?? 'N/A'}
- Price target range: $${data.yahooData.currentFinancials?.targetLowPrice ?? 'N/A'} – $${data.yahooData.currentFinancials?.targetHighPrice ?? 'N/A'}

## Analyst Buy/Sell/Hold Counts (This Month)
${JSON.stringify(data.yahooData.analystRecommendations?.[0] ?? {}, null, 2)}

## EPS & Revenue Estimates (Next 4 Periods)
${JSON.stringify(data.yahooData.epsEstimates, null, 2)}

## Quarterly Earnings Beats/Misses
${JSON.stringify(data.yahooData.earningsHistory, null, 2)}

## Ownership Breakdown
${JSON.stringify(data.yahooData.ownership, null, 2)}

## Recent Analyst Upgrades/Downgrades
${JSON.stringify(data.yahooData.analystActions, null, 2)}

## Yahoo Finance Key Statistics
- Forward P/E: ${data.yahooData.keyStats?.forwardPE ?? 'N/A'}
- PEG Ratio: ${data.yahooData.keyStats?.pegRatio ?? 'N/A'}
- Price/Book: ${data.yahooData.keyStats?.priceToBook ?? 'N/A'}
- Enterprise Value: ${data.yahooData.keyStats?.enterpriseValue ?? 'N/A'}
- EV/Revenue: ${data.yahooData.keyStats?.enterpriseToRevenue ?? 'N/A'}
- EV/EBITDA: ${data.yahooData.keyStats?.enterpriseToEbitda ?? 'N/A'}
- Short % of Float: ${data.yahooData.keyStats?.shortPercentOfFloat ?? 'N/A'}
- 52-Week Change: ${data.yahooData.keyStats?.weekChange52 ?? 'N/A'}
- Revenue Growth (YoY): ${data.yahooData.currentFinancials?.revenueGrowth ?? 'N/A'}
- Earnings Growth (YoY): ${data.yahooData.currentFinancials?.earningsGrowth ?? 'N/A'}
` : '\n## Yahoo Finance\nData unavailable for this ticker.\n';

  const dataPrompt = `
You are analyzing the company "${companyName}" (Ticker: ${data.ticker}).

Here is all the financial data you need. Use it to produce your investment analysis.

## Company Profile
${JSON.stringify(data.companyProfile, null, 2)}

## Income Statement (Last 3 Years)
${JSON.stringify(data.incomeStatement, null, 2)}

## Balance Sheet (Last 3 Years)
${JSON.stringify(data.balanceSheet, null, 2)}

## Cash Flow Statement (Last 3 Years)
${JSON.stringify(data.cashFlow, null, 2)}

## Key Metrics & Valuation Ratios (FMP)
${JSON.stringify(data.keyMetrics, null, 2)}

## Recent News (Last 8 Articles)
${JSON.stringify(data.recentNews, null, 2)}

## Peer Companies
${JSON.stringify(data.peers)}
${yahooSection}
---

Now produce your complete investment analysis as a single valid JSON object matching the format specified in your instructions. Output only the JSON with no extra text or markdown.
`;

  // ── Step 3: Single Gemini call ───────────────────────────────────────────────
  console.log(`🤖 Sending data to Gemini for analysis (1 API call)...`);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: ANALYST_PROMPT,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json', // Force JSON output — no markdown fences
    },
  });

  const result = await model.generateContent(dataPrompt);
  const rawText = result.response.text();

  console.log('🔍 Raw Gemini output (first 300 chars):', rawText.slice(0, 300));

  // ── Step 4: Parse JSON ───────────────────────────────────────────────────────
  // responseMimeType:'application/json' means no code fences, but strip just in case
  const stripped = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  let analysis;
  try {
    analysis = JSON.parse(stripped);
  } catch {
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ Full Gemini output:', rawText);
      throw new Error('Gemini did not return valid JSON');
    }
    analysis = JSON.parse(jsonMatch[0]);
  }

  // ── Step 5: Attach the raw FMP data so the frontend can display it ─────────
  return { ...analysis, rawData: data };
};
