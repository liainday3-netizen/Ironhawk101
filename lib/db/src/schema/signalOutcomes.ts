import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Signal outcomes — the decision record that turns the `signals` table into a
 * supervised dataset.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `signals` records every signal the scanner produced. `positions` records a
 * row only when a trade actually opened. So a signal that fired and was then
 * blocked — by a guard, a stale scan, a price-drift check, a capital limit —
 * leaves NO trace of the decision beyond an absence. Absence is ambiguous: the
 * row might have no position because it was blocked, because execution failed,
 * or because it is still in flight.
 *
 * Inferring negative examples from missing rows would build a training set on
 * a guess. This table records the reason directly, so every signal has an
 * explicit verdict and a model can learn from the trades that were correctly
 * NOT taken — which is where most of the useful signal lives.
 *
 * Rows are written for every terminal decision on a signal, including
 * successful executions (executed = 1, with positionId pointing at the result).
 */
export const signalOutcomesTable = pgTable("signal_outcomes", {
  id: serial("id").primaryKey(),
  signalId: integer("signal_id").notNull(),
  pairId: integer("pair_id").notNull(),
  chain: text("chain").notNull(),
  direction: text("direction").notNull(), // BUY | SELL

  /** 1 only when a position was actually opened for this signal. */
  executed: integer("executed").notNull().default(0),

  /**
   * Machine-readable verdict. Stable strings, safe to group by in SQL:
   *   EXECUTED                     — position opened
   *   LOCK_UNAVAILABLE             — another trade held the advisory lock
   *   PAIR_UNAVAILABLE             — pair missing or token mismatch
   *   TRADING_DISABLED             — guard refused entries or closes
   *   SIGNAL_STALE                 — scan older than the freshness window
   *   GUARD_BLOCKED                — adaptive execution guard not clear
   *   STATE_MISMATCH               — pair no longer in the required exec state
   *   MARKET_DATA_UNAVAILABLE      — fresh DEX data missing / below min liquidity
   *   PRICE_DRIFT                  — market moved past the entry tolerance
   *   NO_POSITION_TO_CLOSE         — SELL with nothing open
   *   POSITION_LIMIT               — concurrency, capital or auto-execute gate
   *   RISK_ZERO                    — adaptive risk resolved to zero
   *   NO_WALLET                    — no signing wallet configured for the chain
   *   EXECUTION_FAILED             — broadcast failed before confirmation
   *   RECONCILIATION_REQUIRED      — broadcast but result unverified
   */
  verdict: text("verdict").notNull(),

  /** Human-readable detail — the guard's own message where one exists. */
  reason: text("reason"),

  /** Set only when executed = 1. */
  positionId: integer("position_id"),

  /** Size the engine would have used, recorded even when blocked. */
  intendedSizeUsd: real("intended_size_usd"),

  /** Signal context copied at decision time so the row is self-contained. */
  confidenceScore: real("confidence_score"),
  liquidityScore: real("liquidity_score"),
  volatilityRatio: real("volatility_ratio"),
  atrPct: real("atr_pct"),
  marketRegime: text("market_regime"),
  executionGuard: text("execution_guard"),
  price: real("price"),
  obHigh: real("ob_high"),
  obLow: real("ob_low"),

  /** How long after the scan the decision was made, in ms. */
  signalAgeMs: integer("signal_age_ms"),

  decidedAt: timestamp("decided_at").notNull().defaultNow(),
});

export const insertSignalOutcomeSchema = createInsertSchema(signalOutcomesTable).omit({
  id: true,
  decidedAt: true,
});

export type InsertSignalOutcome = z.infer<typeof insertSignalOutcomeSchema>;
export type SignalOutcome = typeof signalOutcomesTable.$inferSelect;
