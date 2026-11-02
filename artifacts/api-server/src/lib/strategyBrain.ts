/**
 * StrategyBrain — a self-contained learning core for IronHawk101 signals.
 *
 * WHAT THIS IS
 * ────────────
 * A perceptron-style weight learner over the REAL features that IronHawk101's
 * microstructure engine produces and persists in `signals` /
 * `signal_outcomes`. It learns which signal conditions precede profitable
 * trades, and uses that to (a) gate marginal entries and (b) scale size.
 *
 * WHAT THIS IS NOT
 * ────────────────
 * No hidden layers, no backpropagation. It must NOT be surfaced in any UI as
 * a neural network — that would repeat the `GEN G1 · EVOLUTIONS 0` overclaim
 * found on a project with no evolution at all. What it is: a single-layer
 * linear model with a real, inspectable update rule, trained on real
 * outcomes. Small, but honest.
 *
 * DESIGN RULES CARRIED IN FROM OTHER PROJECTS
 * ───────────────────────────────────────────
 * 1. Asymmetric reward (won ? 1 : -0.8) — a single loss should not dominate
 *    the fit the way a single win does.
 * 2. Learning-rate decay across generations — the model should settle.
 * 3. Bounded, renormalised weights — no feature fully discarded, none dominant.
 * 4. THE BRAIN CAN ONLY SUPPRESS. It never originates a signal. If the
 *    microstructure engine did not fire, no learned weight can create a trade.
 * 5. Absent is not zero. A missing feature blocks evaluation; it is never
 *    silently read as a bearish or neutral reading.
 *
 * No database, no network, no wallet, no imports. Pure computation, so the
 * learning rule can be replayed and validated before it is wired to a live
 * execution path.
 *
 * STATUS: the logic below is the direct port of a JavaScript implementation
 * that passed all five behavioural checks (planted-edge detection, the
 * suppress-only guarantee, missing-feature handling, warm-up deferral, and
 * lossless persistence). It has not yet been compiled in this repository —
 * run `pnpm run typecheck` from the repo root before wiring it in.
 */

export const FEATURES = [
  "confidence",   // confidenceScore / 100
  "regime",       // market regime, encoded
  "volatility",   // volatilityRatio, squashed
  "atr",          // atrPct, squashed
  "liquidity",    // liquidityScore / 100
  "obStrength",   // how far into the order block price sits
] as const;

export type FeatureName = (typeof FEATURES)[number];

export type FeatureVector = Record<FeatureName, number | null>;

export interface BrainConfig {
  learningRate: number;
  lrDecay: number;
  minLearningRate: number;
  winReward: number;
  lossReward: number;
  weightFloor: number;
  weightCeil: number;
  mutationsPerGeneration: number;
  suppressThreshold: number;
  fullSizeThreshold: number;
  minTradesToAct: number;
}

export const DEFAULT_CONFIG: BrainConfig = {
  learningRate: 0.06,
  lrDecay: 0.95,
  minLearningRate: 0.008,
  winReward: 1.0,
  lossReward: -0.8,        // asymmetric: rule 1
  weightFloor: 0.05,       // rule 3
  weightCeil: 0.55,
  mutationsPerGeneration: 15,
  suppressThreshold: 0.42,
  fullSizeThreshold: 0.62,
  minTradesToAct: 30,
};

/** The subset of a signal row the brain needs. Matches the signals table. */
export interface SignalFeatures {
  confidenceScore?: number | null;
  liquidityScore?: number | null;
  volatilityRatio?: number | null;
  atrPct?: number | null;
  marketRegime?: string | null;
  obHigh?: number | null;
  obLow?: number | null;
  price?: number | null;
  direction?: "BUY" | "SELL" | string | null;
  /** Microstructure state; the brain refuses to act unless this is an exec state. */
  state?: string | null;
}

export interface Decision {
  allowed: boolean;
  sizeMultiplier: number;
  learnedScore: number | null;
  reason: string;
  warmingUp?: boolean;
}

export interface BrainStats {
  generation: number;
  mutations: number;
  learningRate: number;
  tradeCount: number;
  trainedCount: number;
  skippedCount: number;
  winRateAll: number | null;
  winRateRecent: number | null;
  totalPnl: number;
  weights: Record<FeatureName, number>;
}

export interface BrainSnapshot {
  version: 1;
  weights: Record<FeatureName, number>;
  generation: number;
  mutations: number;
  learningRate: number;
  tradeCount: number;
  trainedCount: number;
  skippedCount: number;
}

const REGIME_ENCODING: Record<string, number | null> = {
  CALM: 0.25,
  NORMAL: 0.5,
  VOLATILE: 0.75,
  EXTREME: 1.0,
  UNKNOWN: null,   // rule 5: unknown is NOT a value
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Maps [0, inf) into [0, 1) monotonically. Null for anything not finite/positive. */
function squash(x: number | null | undefined, scale: number): number | null {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return null;
  return x / (x + scale);
}

/**
 * Turns a raw signal row into a feature vector.
 *
 * Every feature is either a finite number in [0,1] or null. A null means "not
 * measured". Any vector containing one is not silently coerced — the caller
 * receives `missing` so it can decline to act or learn rather than fit a hole.
 */
export function extractFeatures(signal: SignalFeatures): {
  features: FeatureVector;
  missing: FeatureName[];
} {
  const missing: FeatureName[] = [];
  const f: FeatureVector = {
    confidence: null,
    regime: null,
    volatility: null,
    atr: null,
    liquidity: null,
    obStrength: null,
  };

  const numeric = (name: FeatureName, transformed: number | null) => {
    if (transformed === null || !Number.isFinite(transformed)) {
      missing.push(name);
      f[name] = null;
    } else {
      f[name] = clamp(transformed, 0, 1);
    }
  };

  numeric("confidence",
    typeof signal.confidenceScore === "number" && signal.confidenceScore > 0
      ? signal.confidenceScore / 100 : null);
  numeric("liquidity",
    typeof signal.liquidityScore === "number" && signal.liquidityScore > 0
      ? signal.liquidityScore / 100 : null);
  numeric("volatility", squash(signal.volatilityRatio, 1.5));
  numeric("atr", squash(signal.atrPct, 6));

  const regime = signal.marketRegime === null || signal.marketRegime === undefined
    ? null
    : REGIME_ENCODING[signal.marketRegime];
  if (regime === null || regime === undefined) {
    missing.push("regime");
    f.regime = null;
  } else {
    f.regime = regime;
  }

  // Order-block strength: where price sits inside the OB, from the edge the
  // trade is leaning on. Near the entry edge = stronger expected reaction.
  const { obHigh, obLow, price, direction } = signal;
  if (
    typeof obHigh === "number" && typeof obLow === "number" && typeof price === "number" &&
    Number.isFinite(obHigh) && Number.isFinite(obLow) && Number.isFinite(price) &&
    obHigh > obLow && price >= obLow && price <= obHigh
  ) {
    const position = (price - obLow) / (obHigh - obLow);
    f.obStrength = direction === "BUY" ? 1 - position : position;
  } else {
    missing.push("obStrength");
    f.obStrength = null;
  }

  return { features: f, missing };
}

export class StrategyBrain {
  private cfg: BrainConfig;
  private weights: Record<FeatureName, number>;
  private trades: { pnl: number; won: boolean; ts: number }[] = [];
  generation = 1;
  mutations = 0;
  learningRate: number;
  tradeCount = 0;
  trainedCount = 0;
  skippedCount = 0;

  constructor(opts: Partial<BrainConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...opts };
    const even = 1 / FEATURES.length;
    this.weights = {
      confidence: even, regime: even, volatility: even,
      atr: even, liquidity: even, obStrength: even,
    };
    this.learningRate = this.cfg.learningRate;
  }

  /** Linear score over the learned weights. Null if any feature is missing. */
  score(features: FeatureVector): number | null {
    let sum = 0;
    let weightSum = 0;
    for (const name of FEATURES) {
      const value = features[name];
      if (value === null) return null;
      sum += this.weights[name] * value;
      weightSum += this.weights[name];
    }
    return weightSum > 0 ? sum / weightSum : null;
  }

  /**
   * The gate. Called AFTER the microstructure engine has produced a signal —
   * never instead of it.
   *
   * Rule 4: `allowed` is true only when the engine fired AND the brain does
   * not object. The brain cannot turn a HOLD into a trade.
   */
  decide(signal: SignalFeatures): Decision {
    const { features, missing } = extractFeatures(signal);
    const engineFired = signal.state === "BULL_EXEC" || signal.state === "BEAR_EXEC";

    if (!engineFired) {
      return {
        allowed: false, sizeMultiplier: 0, learnedScore: null,
        reason: "Engine produced no executable signal — brain cannot originate one",
      };
    }
    if (missing.length > 0) {
      return {
        allowed: false, sizeMultiplier: 0, learnedScore: null,
        reason: `Cannot evaluate: unmeasured feature(s) ${missing.join(", ")}`,
      };
    }
    // Not enough history: defer entirely to the engine's own guards.
    if (this.trainedCount < this.cfg.minTradesToAct) {
      return {
        allowed: true, sizeMultiplier: 1, learnedScore: this.score(features),
        reason: `Warming up (${this.trainedCount}/${this.cfg.minTradesToAct} trades) — engine guards only`,
        warmingUp: true,
      };
    }

    const learned = this.score(features);
    if (learned === null) {
      return { allowed: false, sizeMultiplier: 0, learnedScore: null, reason: "Feature vector incomplete" };
    }
    if (learned < this.cfg.suppressThreshold) {
      return {
        allowed: false, sizeMultiplier: 0, learnedScore: learned,
        reason: `Brain suppressed: learned score ${learned.toFixed(3)} < ${this.cfg.suppressThreshold}`,
      };
    }

    const span = this.cfg.fullSizeThreshold - this.cfg.suppressThreshold;
    const sizeMultiplier = clamp((learned - this.cfg.suppressThreshold) / span, 0.4, 1);
    return {
      allowed: true, sizeMultiplier, learnedScore: learned,
      reason: `Brain approved: learned score ${learned.toFixed(3)}`,
    };
  }

  /**
   * Records an outcome and updates the weights.
   *
   * `pnlUsd` must be the NET realized figure — after gas, fees and slippage.
   * Learning on gross P&L teaches the model to predict overhead rather than
   * market edge, which is the trap that makes fee-dominated small positions
   * useless as training data.
   */
  learn(
    signal: SignalFeatures,
    pnlUsd: number,
    opts: { ts?: number; features?: FeatureVector; missing?: FeatureName[] } = {},
  ): { updated: boolean; won?: boolean; reason?: string } {
    const extracted = opts.features ? null : extractFeatures(signal);
    const vector = opts.features ?? extracted!.features;
    const gaps = opts.missing ?? extracted!.missing;

    this.tradeCount++;
    if (gaps.length > 0) {
      // Rule 5: refuse to fit a row with holes in it.
      this.skippedCount++;
      return { updated: false, reason: `Skipped: missing ${gaps.join(", ")}` };
    }

    const won = pnlUsd > 0;
    const reward = won ? this.cfg.winReward : this.cfg.lossReward;

    for (const name of FEATURES) {
      const current = this.weights[name];
      const next = current + reward * (vector[name] as number) * this.learningRate;
      this.weights[name] = clamp(next, this.cfg.weightFloor, this.cfg.weightCeil);
    }
    // Renormalise so the score's scale is stable across generations.
    const total = FEATURES.reduce((sum, n) => sum + this.weights[n], 0);
    for (const name of FEATURES) this.weights[name] = this.weights[name] / total;

    this.trades.unshift({ pnl: pnlUsd, won, ts: opts.ts ?? Date.now() });
    if (this.trades.length > 500) this.trades.pop();

    this.trainedCount++;
    this.mutations++;
    if (this.trainedCount % this.cfg.mutationsPerGeneration === 0) {
      this.generation++;
      this.learningRate = Math.max(this.cfg.minLearningRate, this.learningRate * this.cfg.lrDecay);
    }

    return { updated: true, won };
  }

  stats(): BrainStats {
    const wins = this.trades.filter((t) => t.won).length;
    const recent = this.trades.slice(0, 50);
    const recentWins = recent.filter((t) => t.won).length;
    const weights = {} as Record<FeatureName, number>;
    for (const name of FEATURES) weights[name] = Number(this.weights[name].toFixed(4));
    return {
      generation: this.generation,
      mutations: this.mutations,
      learningRate: Number(this.learningRate.toFixed(4)),
      tradeCount: this.tradeCount,
      trainedCount: this.trainedCount,
      skippedCount: this.skippedCount,
      winRateAll: this.trades.length ? wins / this.trades.length : null,
      winRateRecent: recent.length ? recentWins / recent.length : null,
      totalPnl: this.trades.reduce((s, t) => s + t.pnl, 0),
      weights,
    };
  }

  toJSON(): BrainSnapshot {
    return {
      version: 1,
      weights: { ...this.weights },
      generation: this.generation,
      mutations: this.mutations,
      learningRate: this.learningRate,
      tradeCount: this.tradeCount,
      trainedCount: this.trainedCount,
      skippedCount: this.skippedCount,
    };
  }

  static fromJSON(blob: Partial<BrainSnapshot>, opts: Partial<BrainConfig> = {}): StrategyBrain {
    const brain = new StrategyBrain(opts);
    if (blob.weights) {
      for (const name of FEATURES) {
        const value = blob.weights[name];
        if (typeof value === "number" && Number.isFinite(value)) brain.weights[name] = value;
      }
    }
    brain.generation = blob.generation ?? 1;
    brain.mutations = blob.mutations ?? 0;
    brain.learningRate = blob.learningRate ?? brain.cfg.learningRate;
    brain.tradeCount = blob.tradeCount ?? 0;
    brain.trainedCount = blob.trainedCount ?? 0;
    brain.skippedCount = blob.skippedCount ?? 0;
    return brain;
  }
}

// ── Replay harness ───────────────────────────────────────────────────────────

export interface TrainingSample {
  signal: SignalFeatures;
  pnlUsd: number;
  ts?: number;
}

/** Deterministic PRNG so a replay is reproducible. */
function makeRand(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Builds a sample set where exactly one feature predicts the outcome, so a
 * correct learning rule must find it. If the brain does not raise
 * `confidence`'s weight on this input, the rule is broken.
 */
export function syntheticSamples(n = 400, seed = 42): TrainingSample[] {
  const rand = makeRand(seed);
  const samples: TrainingSample[] = [];
  for (let i = 0; i < n; i++) {
    const confidence = rand();
    const edge = confidence - 0.5;          // the only real driver
    const pnlUsd = edge * 0.4 + (rand() - 0.5) * 0.05;
    samples.push({
      signal: {
        confidenceScore: confidence * 100,
        liquidityScore: 40 + rand() * 60,
        volatilityRatio: 0.5 + rand() * 2,
        atrPct: 0.5 + rand() * 6,
        marketRegime: ["CALM", "NORMAL", "VOLATILE"][Math.floor(rand() * 3)],
        obHigh: 100, obLow: 90, price: 90 + rand() * 10,
        direction: "BUY", state: "BULL_EXEC",
      },
      pnlUsd,
    });
  }
  return samples;
}

export function replay(
  samples: TrainingSample[],
  opts: Partial<BrainConfig> = {},
): {
  brain: StrategyBrain;
  stats: BrainStats;
  deltas: { feature: FeatureName; before: number; after: number; delta: number }[];
} {
  const brain = new StrategyBrain(opts);
  const before = { ...brain.toJSON().weights };
  for (const sample of samples) {
    brain.learn(sample.signal, sample.pnlUsd, { ts: sample.ts });
  }
  const stats = brain.stats();
  const deltas = FEATURES.map((name) => ({
    feature: name,
    before: Number(before[name].toFixed(4)),
    after: stats.weights[name],
    delta: Number((stats.weights[name] - before[name]).toFixed(4)),
  })).sort((a, b) => b.delta - a.delta);
  return { brain, stats, deltas };
}
