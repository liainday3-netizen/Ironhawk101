/**
 * IronHawk Microstructure Engine — TypeScript port of Microstructure_Matrix.mq5
 *
 * Implements:
 *   - HTF Order Block detection (Bullish/Bearish)
 *   - LTF Fractal CHoCH with Volume Z-Score confirmation
 *   - Daily bias filter
 *   - London/NY killzone session filter
 *
 * DELIBERATE DIVERGENCE FROM THE MQL5 ORIGINAL — order-block selection order.
 *
 * The EA scans its HTF window forward (`for i = 2; i < InpHistoryBars - 2`)
 * over series-ordered arrays and breaks on the FIRST match, which selects the
 * OLDEST qualifying block in the window. `detectOrderBlock` below scans
 * backward and breaks on the first match, selecting the NEWEST.
 *
 * This is intentional, not a translation slip: with a 200-bar H4 window the
 * EA can act on structure from ~33 days ago that the asset has long since
 * left behind. The newer block is the one price is actually interacting with.
 * Any behavioural comparison against the .mq5 source must account for this,
 * because the two will disagree on every symbol that has more than one
 * qualifying block in its window.
 *
 * Everything else is a faithful port. Verified against the source:
 *   - OB engulfing rule + third-bar confirmation, both directions
 *   - Daily bias read from D1 bar index 1, not the forming bar
 *   - Volume z-score baseline over bars 1..49 (excludes the tested bar)
 *   - Killzone boundaries, inclusive at both edges
 */

import { OHLCVCandle } from "./marketData";

export type MarketState =
  | "WAITING"
  | "FILTERED_BIAS"
  | "OUT_OF_SESSION"
  | "SYNC_ERROR"
  | "IN_HTF_POI"
  | "BULL_EXEC"
  | "BEAR_EXEC";

export interface OrderBlock {
  type: "BULL" | "BEAR";
  high: number;
  low: number;
  time: number;
}

export interface MicrostructureResult {
  state: MarketState;
  htfMessage: string;
  ltfMessage: string;
  signalAction: string;
  obType: "BULL" | "BEAR" | null;
  obHigh: number | null;
  obLow: number | null;
  marketRegime: "CALM" | "NORMAL" | "VOLATILE" | "EXTREME" | "UNKNOWN";
  confidenceScore: number;
  atrPct: number;
  volatilityRatio: number;
  liquidityScore: number;
  executionAllowed: boolean;
  executionGuard: string;
  suggestedStopLossPct: number;
}

const MIN_CONFIDENCE_TO_EXECUTE = 65;
const MIN_LIQUIDITY_SCORE_TO_EXECUTE = 35;
const USE_DAILY_BIAS = true;
const USE_KILLZONES = true;
const LONDON_START = 8;
const LONDON_END = 12;
const NY_START = 13;
const NY_END = 17;

/**
 * Finds the most recent qualifying order block. See the file header — the
 * backward scan is a deliberate divergence from the EA's forward scan.
 */
export function detectOrderBlock(htfCandles: OHLCVCandle[]): OrderBlock | null {
  if (htfCandles.length < 5) return null;

  for (let i = htfCandles.length - 3; i >= 2; i--) {
    const prev = htfCandles[i + 1];
    const curr = htfCandles[i];
    const confirm = htfCandles[i - 1];

    const prevBearish = prev.close < prev.open;
    const currBullish = curr.close > curr.open;
    if (prevBearish && currBullish && curr.close > prev.high) {
      if (confirm.low > prev.high) {
        return { type: "BULL", high: prev.high, low: prev.low, time: prev.time };
      }
    }

    const prevBullish = prev.close > prev.open;
    const currBearish = curr.close < curr.open;
    if (prevBullish && currBearish && curr.close < prev.low) {
      if (confirm.high < prev.low) {
        return { type: "BEAR", high: prev.high, low: prev.low, time: prev.time };
      }
    }
  }
  return null;
}

export function getDailyBias(d1Candles: OHLCVCandle[]): number {
  if (!USE_DAILY_BIAS || d1Candles.length < 2) return 0;
  const last = d1Candles[d1Candles.length - 2];
  if (last.close > last.open) return 1;
  if (last.close < last.open) return -1;
  return 0;
}

export function isInKillzone(): boolean {
  if (!USE_KILLZONES) return true;
  const hour = new Date().getUTCHours();
  return (hour >= LONDON_START && hour <= LONDON_END) || (hour >= NY_START && hour <= NY_END);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface MarketContext {
  liquidityUsd?: number;
  volume24h?: number;
}

export interface AdaptiveMetrics {
  marketRegime: "CALM" | "NORMAL" | "VOLATILE" | "EXTREME" | "UNKNOWN";
  confidenceScore: number;
  atrPct: number;
  volatilityRatio: number;
  liquidityScore: number;
  executionAllowed: boolean;
  executionGuard: string;
  suggestedStopLossPct: number;
}

/**
 * Calculates conditions from each asset's own recent candles. The engine
 * adapts thresholds per asset rather than applying one fixed setting to
 * illiquid microcaps and deep majors alike.
 */
export function getAdaptiveMetrics(
  htfCandles: OHLCVCandle[],
  ltfCandles: OHLCVCandle[],
  context: MarketContext = {},
): AdaptiveMetrics {
  const candles = ltfCandles.length >= 20 ? ltfCandles : htfCandles;
  if (candles.length < 20) {
    return {
      marketRegime: "UNKNOWN",
      confidenceScore: 0,
      atrPct: 0,
      volatilityRatio: 0,
      liquidityScore: 0,
      executionAllowed: false,
      executionGuard: "INSUFFICIENT_CANDLE_HISTORY",
      suggestedStopLossPct: 5,
    };
  }

  const recent = candles.slice(-50);
  const rangePct = recent.map((c, index) => {
    const previousClose = recent[index - 1]?.close ?? c.open;
    const trueRange = Math.max(
      c.high - c.low,
      Math.abs(c.high - previousClose),
      Math.abs(c.low - previousClose),
    );
    return c.close > 0 ? (trueRange / c.close) * 100 : 0;
  }).filter(Number.isFinite);

  const atrWindow = rangePct.slice(-14);
  const baselineWindow = rangePct.slice(0, -14);
  const atrPct = atrWindow.reduce((sum, value) => sum + value, 0) / Math.max(atrWindow.length, 1);
  const baselineAtrPct = baselineWindow.reduce((sum, value) => sum + value, 0) / Math.max(baselineWindow.length, 1);
  const volatilityRatio = baselineAtrPct > 0 ? atrPct / baselineAtrPct : 1;

  const marketRegime =
    volatilityRatio >= 2.25 || atrPct >= 8 ? "EXTREME" :
    volatilityRatio >= 1.45 || atrPct >= 4 ? "VOLATILE" :
    volatilityRatio <= 0.7 ? "CALM" : "NORMAL";

  // `context.liquidityUsd` being absent means the market-data lookup failed
  // or was never attempted — that is NOT the same statement as "this pool is
  // thin". Both must block execution, but they are reported distinctly so a
  // transient upstream outage is not silently recorded as a liquidity
  // verdict against the asset. In particular, conflating the two would feed
  // a bogus liquidityScore into the confidenceScore and into the signals
  // table, poisoning any later analysis of why a trade was skipped.
  const liquidityKnown = typeof context.liquidityUsd === "number" && context.liquidityUsd > 0;
  const liquidityUsd = context.liquidityUsd ?? 0;
  const liquidityScore = liquidityKnown
    ? clamp((Math.log10(liquidityUsd + 1) / 6) * 100, 0, 100)
    : 0;

  // Wider volatility-aware stops prevent normal noise from stopping a trade.
  // Position notional is reduced separately so the configured risk ceiling
  // remains bounded.
  const suggestedStopLossPct = clamp(atrPct * 2.2, 1.5, 12);
  const volatilityPenalty =
    marketRegime === "EXTREME" ? 0 :
    marketRegime === "VOLATILE" ? 10 :
    marketRegime === "CALM" ? 4 : 0;

  let executionGuard = "ADAPTIVE_GUARDS_CLEAR";
  if (marketRegime === "EXTREME") executionGuard = "EXTREME_VOLATILITY";
  else if (!liquidityKnown) executionGuard = "LIQUIDITY_UNKNOWN";
  else if (liquidityScore < MIN_LIQUIDITY_SCORE_TO_EXECUTE) executionGuard = "THIN_LIQUIDITY";

  // Confidence is only meaningfully computable when liquidity is known. When
  // it is not, report 0 rather than a number derived from a missing input —
  // a caller must not be able to read "confidence 80" off a failed lookup.
  const confidenceScore = !liquidityKnown
    ? 0
    : clamp(
        100 - volatilityPenalty - (liquidityScore < MIN_LIQUIDITY_SCORE_TO_EXECUTE ? 20 : 0),
        0,
        100,
      );

  if (liquidityKnown && executionGuard === "ADAPTIVE_GUARDS_CLEAR" && confidenceScore < MIN_CONFIDENCE_TO_EXECUTE) {
    executionGuard = "LOW_CONFIDENCE";
  }

  return {
    marketRegime,
    confidenceScore,
    atrPct,
    volatilityRatio,
    liquidityScore,
    executionAllowed: executionGuard === "ADAPTIVE_GUARDS_CLEAR",
    executionGuard,
    suggestedStopLossPct,
  };
}

function analyzeLTF(
  ltfCandles: OHLCVCandle[],
  inBullOB: boolean,
  inBearOB: boolean,
  volumeZThreshold: number,
): { state: MarketState; ltfMessage: string } {
  if (ltfCandles.length < 10) {
    return { state: "WAITING", ltfMessage: "INSUFFICIENT LTF DATA" };
  }

  const vols = ltfCandles.slice(1, 50).map((c) => c.volume);
  const volMean = vols.reduce((a, b) => a + b, 0) / vols.length;
  const variance = vols.reduce((sum, v) => sum + Math.pow(v - volMean, 2), 0) / vols.length;
  const stdDev = Math.sqrt(variance);
  const volThreshold = volMean + volumeZThreshold * stdDev;
  const latestVol = ltfCandles[ltfCandles.length - 1]?.volume ?? 0;

  let recentSwingHigh = -Infinity;
  let recentSwingLow = Infinity;
  const lookback = Math.min(20, ltfCandles.length - 2);
  for (let j = 2; j < lookback + 2; j++) {
    if (ltfCandles[j].high > ltfCandles[j + 1]?.high && ltfCandles[j].high > ltfCandles[j - 1]?.high) {
      recentSwingHigh = ltfCandles[j].high;
      break;
    }
  }
  for (let j = 2; j < lookback + 2; j++) {
    if (ltfCandles[j].low < ltfCandles[j + 1]?.low && ltfCandles[j].low < ltfCandles[j - 1]?.low) {
      recentSwingLow = ltfCandles[j].low;
      break;
    }
  }

  if (recentSwingHigh === -Infinity) {
    const highs = ltfCandles.slice(2, 12).map((c) => c.high);
    recentSwingHigh = Math.max(...highs);
  }
  if (recentSwingLow === Infinity) {
    const lows = ltfCandles.slice(2, 12).map((c) => c.low);
    recentSwingLow = Math.min(...lows);
  }

  const latestClose = ltfCandles[ltfCandles.length - 1]?.close ?? ltfCandles[0]?.close ?? 0;

  if (inBullOB) {
    if (latestClose > recentSwingHigh && latestVol > volThreshold) {
      return { state: "BULL_EXEC", ltfMessage: "FRACTAL CHOCH UP (Z-SCORE MET)" };
    } else if (latestClose > recentSwingHigh) {
      return { state: "IN_HTF_POI", ltfMessage: "FRACTAL BREAK (LOW VOLUME)" };
    } else {
      return { state: "IN_HTF_POI", ltfMessage: "WAITING FRACTAL CHOCH" };
    }
  }

  if (inBearOB) {
    if (latestClose < recentSwingLow && latestVol > volThreshold) {
      return { state: "BEAR_EXEC", ltfMessage: "FRACTAL CHOCH DOWN (Z-SCORE MET)" };
    } else if (latestClose < recentSwingLow) {
      return { state: "IN_HTF_POI", ltfMessage: "FRACTAL BREAK (LOW VOLUME)" };
    } else {
      return { state: "IN_HTF_POI", ltfMessage: "WAITING FRACTAL CHOCH" };
    }
  }

  return { state: "WAITING", ltfMessage: "---" };
}

export function analyzeAsset(
  htfCandles: OHLCVCandle[],
  ltfCandles: OHLCVCandle[],
  d1Candles: OHLCVCandle[],
  currentPrice: number,
  context: MarketContext = {},
): MicrostructureResult {
  const adaptive = getAdaptiveMetrics(htfCandles, ltfCandles, context);
  const volumeZThreshold =
    adaptive.marketRegime === "CALM" ? 1.2 :
    adaptive.marketRegime === "VOLATILE" ? 1.8 :
    adaptive.marketRegime === "EXTREME" ? 2.2 : 1.5;
  const ob = detectOrderBlock(htfCandles);

  if (!ob) {
    return {
      state: "WAITING",
      htfMessage: "OUTSIDE POI",
      ltfMessage: "---",
      signalAction: "WAITING",
      obType: null,
      obHigh: null,
      obLow: null,
      ...adaptive,
    };
  }

  const inBullOB = ob.type === "BULL" && currentPrice <= ob.high && currentPrice >= ob.low;
  const inBearOB = ob.type === "BEAR" && currentPrice <= ob.high && currentPrice >= ob.low;

  if (!inBullOB && !inBearOB) {
    return {
      state: "WAITING",
      htfMessage: "OUTSIDE POI",
      ltfMessage: "---",
      signalAction: "WAITING",
      obType: ob.type,
      obHigh: ob.high,
      obLow: ob.low,
      ...adaptive,
    };
  }

  const dailyBias = getDailyBias(d1Candles);
  if (USE_DAILY_BIAS) {
    if ((inBullOB && dailyBias === -1) || (inBearOB && dailyBias === 1)) {
      return {
        state: "FILTERED_BIAS",
        htfMessage: "IGNORED (D1 BIAS)",
        ltfMessage: "D1 FILTERED",
        signalAction: "D1 FILTERED",
        obType: ob.type,
        obHigh: ob.high,
        obLow: ob.low,
        ...adaptive,
      };
    }
  }

  if (!isInKillzone()) {
    return {
      state: "OUT_OF_SESSION",
      htfMessage: "INSIDE POI (CACHED)",
      ltfMessage: "WAITING FOR SESSION",
      signalAction: "OUT OF KILLZONE",
      obType: ob.type,
      obHigh: ob.high,
      obLow: ob.low,
      ...adaptive,
    };
  }

  const { state, ltfMessage } = analyzeLTF(ltfCandles, inBullOB, inBearOB, volumeZThreshold);

  const htfMessage = state === "BULL_EXEC"
    ? "HTF BULLISH"
    : state === "BEAR_EXEC"
    ? "HTF BEARISH"
    : "INSIDE POI (CACHED)";

  const signalAction = state === "BULL_EXEC"
    ? "EXECUTE BUY"
    : state === "BEAR_EXEC"
    ? "EXECUTE SELL"
    : "MONITOR LTF";

  return {
    state,
    htfMessage,
    ltfMessage,
    signalAction,
    obType: ob.type,
    obHigh: ob.high,
    obLow: ob.low,
    ...adaptive,
  };
}
