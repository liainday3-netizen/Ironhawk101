import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  pairId: integer("pair_id").notNull(),
  symbol: text("symbol").notNull(),
  chain: text("chain").notNull(),
  dex: text("dex").notNull(),
  direction: text("direction").notNull(), // BUY | SELL
  price: real("price").notNull(),
  obHigh: real("ob_high").notNull(),
  obLow: real("ob_low").notNull(),
  ltfMessage: text("ltf_message").notNull(),
  marketRegime: text("market_regime").notNull().default("UNKNOWN"),
  confidenceScore: real("confidence_score").notNull().default(0),
  atrPct: real("atr_pct").notNull().default(0),
  liquidityScore: real("liquidity_score").notNull().default(0),
  adaptiveRiskPct: real("adaptive_risk_pct").notNull().default(0),
  executionGuard: text("execution_guard").notNull().default("NOT_EVALUATED"),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({
  id: true,
  triggeredAt: true,
});

export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
