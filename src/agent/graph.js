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
  // ── Step 1: Gather all data from FMP APIs (or Screener.in for Indian companies) ─
  const data = await gatherCompanyData(companyName, preferredTicker);

  const isIndian = data.market === 'INDIA';
  const currencySymbol = isIndian ? '₹' : '$';

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

  // Build SEC EDGAR supplemental section
  const edgarFacts = data.edgarData?.facts;
  const edgarFilings = data.edgarData?.filings;
  const edgarSection = data.edgarData ? `
## SEC EDGAR (Official US Government Filings)
Entity Name: ${edgarFacts?.entityName ?? 'N/A'}
CIK: ${data.edgarData.cik}

### Revenue History (Annual, from 10-K filings)
${JSON.stringify(edgarFacts?.revenueHistory?.slice(0, 5) ?? [], null, 2)}

### Net Income History (Annual)
${JSON.stringify(edgarFacts?.netIncomeHistory?.slice(0, 5) ?? [], null, 2)}

### EPS Diluted History (Annual)
${JSON.stringify(edgarFacts?.epsDilutedHistory?.slice(0, 5) ?? [], null, 2)}

### R&D Expense History (Annual)
${JSON.stringify(edgarFacts?.rdHistory?.slice(0, 5) ?? [], null, 2)}

### Operating Cash Flow History (Annual)
${JSON.stringify(edgarFacts?.operatingCFHistory?.slice(0, 5) ?? [], null, 2)}

### Total Assets History (Annual)
${JSON.stringify(edgarFacts?.assetsHistory?.slice(0, 3) ?? [], null, 2)}

### Shares Outstanding History (Annual)
${JSON.stringify(edgarFacts?.sharesHistory?.slice(0, 3) ?? [], null, 2)}

### Latest Filings
- Latest 10-K: ${edgarFilings?.latest10K?.date ?? 'N/A'} (Annual Report)
- Latest 10-Q: ${edgarFilings?.latest10Q?.date ?? 'N/A'} (Quarterly Report)
- Recent 8-Ks (last 90 days): ${edgarFilings?.recent8Ks?.length ?? 0}
` : '\n## SEC EDGAR\nData unavailable (likely non-US company).\n';

  // Build cross-source comparison summary for Gemini
  const cs = data.crossSource ?? {};
  const lowAgreements = Object.values(cs).filter(p => p.agreement === 'LOW');
  const sourceNames = isIndian ? 'Screener.in and Yahoo Finance' : 'FMP, Yahoo Finance, and SEC EDGAR';
  const crossSourceSection = `
## Cross-Source Data Agreement Summary
Data was collected from: ${sourceNames}.
${
  lowAgreements.length > 0
    ? `⚠️ LOW AGREEMENT detected on: ${lowAgreements.map(p => p.label).join(', ')}. Consider mentioning data confidence caveats.`
    : '✅ All overlapping data points show HIGH or MEDIUM agreement across sources. Data is reliable.'
}
`;

  // Build Indian-specific data section
  const indianSection = isIndian && data.indianData ? (() => {
    // Build a concise shareholding summary with trend
    const shp = data.indianData.shareholding;
    let shpSummary = 'Not available';
    if (shp) {
      shpSummary = `Latest (${shp.latestQuarter || 'N/A'}): Promoter: ${shp.promoter ?? 'N/A'}% | FII: ${shp.fii ?? 'N/A'}% | DII: ${shp.dii ?? 'N/A'}% | Public: ${shp.public ?? 'N/A'}%`;
      if (shp.trend?.length > 1) {
        const first = shp.trend[0];
        const last = shp.trend[shp.trend.length - 1];
        const promoterDelta = first.promoter != null && last.promoter != null ? (last.promoter - first.promoter).toFixed(2) : null;
        const fiiDelta = first.fii != null && last.fii != null ? (last.fii - first.fii).toFixed(2) : null;
        shpSummary += `\nTrend (${first.quarter} → ${last.quarter}): Promoter ${promoterDelta > 0 ? '+' : ''}${promoterDelta}% | FII ${fiiDelta > 0 ? '+' : ''}${fiiDelta}%`;
      }
    }

    // Build quarterly momentum summary
    const quarters = data.indianData.quarterlyResults ?? [];
    let qMomentum = '';
    if (quarters.length >= 2) {
      const latest = quarters[quarters.length - 1];
      const prev = quarters[quarters.length - 2];
      const revGrowth = latest.revenue && prev.revenue ? ((latest.revenue - prev.revenue) / prev.revenue * 100).toFixed(1) : null;
      const profitGrowth = latest.netProfit && prev.netProfit ? ((latest.netProfit - prev.netProfit) / prev.netProfit * 100).toFixed(1) : null;
      qMomentum = `\nQuarterly Momentum (${prev.quarter} → ${latest.quarter}): Revenue ${revGrowth ? (revGrowth > 0 ? '+' : '') + revGrowth + '%' : 'N/A'} | Net Profit ${profitGrowth ? (profitGrowth > 0 ? '+' : '') + profitGrowth + '%' : 'N/A'} | OPM: ${latest.opmPercent ?? 'N/A'}%`;
    }

    return `
## Indian Company — Additional Data
Market: NSE/BSE (India) | Currency: Indian Rupees (₹) | All figures in Crores unless noted.

### Shareholding Pattern
${shpSummary}

### Full Shareholding Trend (Quarterly)
${JSON.stringify(shp?.trend ?? [], null, 2)}

### Latest Quarterly Results (Last 8 Quarters)
${JSON.stringify(quarters, null, 2)}
${qMomentum}

### Key Ratios from Screener.in (Historical, Multi-Year)
${JSON.stringify(data.indianData.ratiosList?.slice(0, 20) ?? [], null, 2)}

### Data Source
${data.indianData.dataSource ?? 'screener.in + yahoo-finance'}
`;
  })() : '';

  const dataPrompt = `
You are analyzing the company "${companyName}" (Ticker: ${data.ticker}).
${isIndian ? `Market: INDIA (NSE/BSE) | Currency: Indian Rupees (₹) | Use Indian number formatting (Crores, Lakhs).` : `Market: US (NYSE/NASDAQ) | Currency: USD ($).`}

Here is all the financial data you need. Use it to produce your investment analysis.

## Company Profile
${JSON.stringify(data.companyProfile, null, 2)}

## Income Statement (Last 3–5 Years)
${JSON.stringify(data.incomeStatement, null, 2)}

## Balance Sheet (Last 3–5 Years)
${JSON.stringify(data.balanceSheet, null, 2)}

## Cash Flow Statement (Last 3–5 Years)
${JSON.stringify(data.cashFlow, null, 2)}

## Key Metrics & Valuation Ratios
${JSON.stringify(data.keyMetrics, null, 2)}

## Recent News (Last 8 Articles)
${JSON.stringify(data.recentNews, null, 2)}

## Peer Companies
${JSON.stringify(data.peers)}
${yahooSection}
${edgarSection}
${indianSection}
${crossSourceSection}
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
