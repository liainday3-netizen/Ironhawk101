import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  chain: text("chain").notNull(), // solana | ethereum | base | bitcoin
  tokenSymbol: text("token_symbol").notNull(),
  tokenAddress: text("token_address"),
  side: text("side").notNull(), // buy | sell
  entryPriceUsd: numeric("entry_price_usd", { precision: 20, scale: 8 }).notNull(),
  exitPriceUsd: numeric("exit_price_usd", { precision: 20, scale: 8 }),
  amountUsd: numeric("amount_usd", { precision: 20, scale: 8 }).notNull(),
  pnlUsd: numeric("pnl_usd", { precision: 20, scale: 8 }),
  pnlPercent: numeric("pnl_percent", { precision: 10, scale: 4 }),
  txHash: text("tx_hash").notNull(),
  signalState: text("signal_state"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
