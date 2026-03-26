import { getPerformanceHistory, listLessons } from "../lessons.js";

export async function analyzeRecentPerformance({ count = 15 }) {
  const history = getPerformanceHistory({ hours: 168, limit: count }); // 1 week
  
  const recent = history.positions;
  
  if (recent.length < 3) {
    return { 
      message: "Not enough data for analysis. Need at least 3 closed positions.",
      recent_performance: recent.length 
    };
  }

  const losses = recent.filter(p => (p.pnl_usd || 0) < 0);
  const wins = recent.filter(p => (p.pnl_usd || 0) >= 0);
  
  const avgPnlPct = recent.reduce((s, p) => s + (p.pnl_pct || 0), 0) / recent.length;
  const winRate = wins.length / recent.length;

  // Analyze volatility of losses
  const lossVols = losses.map(p => p.volatility).filter(v => v != null && v > 0);
  const avgLossVol = lossVols.length > 0 ? lossVols.reduce((s, v) => s + v, 0) / lossVols.length : null;
  
  // Analyze hold time
  const lossTimes = losses.map(p => p.minutes_held).filter(t => t != null && t > 0);
  const avgLossTime = lossTimes.length > 0 ? lossTimes.reduce((s, t) => s + t, 0) / lossTimes.length : null;
  
  // Analyze organic score
  const lossOrganic = losses.map(p => p.organic_score).filter(o => o != null && o > 0);
  const avgLossOrganic = lossOrganic.length > 0 ? lossOrganic.reduce((s, o) => s + o, 0) / lossOrganic.length : null;
  
  // Analyze fee_tvl_ratio
  const lossFeeTvl = losses.map(p => p.fee_tvl_ratio).filter(f => f != null && f > 0);
  const avgLossFeeTvl = lossFeeTvl.length > 0 ? lossFeeTvl.reduce((s, f) => s + f, 0) / lossFeeTvl.length : null;

  // Find volatility threshold
  const sortedLossVols = [...lossVols].sort((a, b) => b - a);
  const highVolThreshold = sortedLossVols.length > 0 ? sortedLossVols[Math.min(2, sortedLossVols.length - 1)] : null;

  // Find organic threshold from wins
  const winOrganics = wins.map(p => p.organic_score).filter(o => o != null && o > 0);
  const minWinOrganic = winOrganics.length > 0 ? Math.min(...winOrganics) : null;

  const insights = [];
  const recommendations = [];

  if (avgLossVol && avgLossVol > 8) {
    insights.push(`⚠️ High volatility losses: avg vol ${avgLossVol.toFixed(1)}`);
    recommendations.push(`Skip pools with volatility > ${Math.round(avgLossVol)}`);
  }

  if (avgLossTime && avgLossTime < 30) {
    insights.push(`⚠️ Quick losses: avg hold time ${Math.round(avgLossTime)} min`);
    recommendations.push(`Hold positions minimum 30-45 minutes before evaluating`);
  }

  if (avgLossOrganic && avgLossOrganic < 60) {
    insights.push(`⚠️ Low organic score: avg ${avgLossOrganic.toFixed(0)}`);
    recommendations.push(`Only deploy with organic score > ${Math.max(60, Math.round(avgLossOrganic / 10) * 10)}`);
  }

  if (avgLossFeeTvl && avgLossFeeTvl < 0.03) {
    insights.push(`⚠️ Low fee/TVL: avg ${(avgLossFeeTvl * 100).toFixed(1)}%`);
    recommendations.push(`Require fee/TVL > 3% before deploying`);
  }

  if (losses.length > wins.length) {
    insights.push(`📉 Loss rate high: ${losses.length}/${recent.length} closed at loss`);
    recommendations.push(`Be more selective — fewer but better entries`);
  }

  // Positive insights
  const winVols = wins.map(p => p.volatility).filter(v => v != null && v > 0);
  const avgWinVol = winVols.length > 0 ? winVols.reduce((s, v) => s + v, 0) / winVols.length : null;
  if (avgWinVol && avgLossVol && avgWinVol < avgLossVol) {
    insights.push(`✅ Lower vol = better: wins avg vol ${avgWinVol.toFixed(1)}, losses avg vol ${avgLossVol.toFixed(1)}`);
  }

  const winTimes = wins.map(p => p.minutes_held).filter(t => t != null && t > 0);
  const avgWinTime = winTimes.length > 0 ? winTimes.reduce((s, t) => s + t, 0) / winTimes.length : null;
  if (avgWinTime && avgLossTime && avgWinTime > avgLossTime) {
    insights.push(`✅ Patience pays: wins held avg ${Math.round(avgWinTime)} min, losses ${Math.round(avgLossTime)} min`);
  }

  return {
    summary: {
      recent_closed: recent.length,
      wins: wins.length,
      losses: losses.length,
      win_rate: `${(winRate * 100).toFixed(0)}%`,
      avg_pnl_pct: `${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(2)}%`,
    },
    insights,
    recommendations,
    thresholds: {
      max_volatility: highVolThreshold ? Math.round(highVolThreshold) : null,
      min_organic_score: minWinOrganic ? Math.max(60, Math.round(minWinOrganic)) : 60,
      min_fee_tvl_ratio: avgLossFeeTvl && avgLossFeeTvl < 0.05 ? 0.05 : null,
      min_hold_time_minutes: avgLossTime && avgLossTime < 30 ? 30 : null,
    },
  };
}

export async function getDeployRecommendations() {
  const analysis = await analyzeRecentPerformance({ count: 15 });
  
  if (analysis.message) {
    return analysis;
  }

  return {
    message: "Based on recent performance analysis:",
    screening_filters: {
      max_volatility: analysis.thresholds.max_volatility || 10,
      min_organic_score: analysis.thresholds.min_organic_score || 60,
      min_fee_tvl_ratio: analysis.thresholds.min_fee_tvl_ratio || 0.03,
    },
    strategy_notes: [
      "Continue using bid_ask strategy as preferred",
      `Hold minimum ${analysis.thresholds.min_hold_time_minutes || 30} minutes before considering close`,
    ],
    avoid: [
      `High volatility tokens (vol > ${analysis.thresholds.max_volatility || 10})`,
      `Low organic score (< ${analysis.thresholds.min_organic_score || 60})`,
      "Quick entries without waiting for fees to accumulate",
    ]
  };
}
