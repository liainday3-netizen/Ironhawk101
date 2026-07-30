import { pgTable, serial, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const capitalSnapshotsTable = pgTable("capital_snapshots", {
  id: serial("id").primaryKey(),
  totalUsd: numeric("total_usd", { precision: 20, scale: 8 }).notNull(),
  solBalanceUsd: numeric("sol_balance_usd", { precision: 20, scale: 8 }),
  ethBalanceUsd: numeric("eth_balance_usd", { precision: 20, scale: 8 }),
  baseBalanceUsd: numeric("base_balance_usd", { precision: 20, scale: 8 }),
  btcBalanceUsd: numeric("btc_balance_usd", { precision: 20, scale: 8 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCapitalSnapshotSchema = createInsertSchema(capitalSnapshotsTable).omit({ id: true, createdAt: true });
export type InsertCapitalSnapshot = z.infer<typeof insertCapitalSnapshotSchema>;
export type CapitalSnapshot = typeof capitalSnapshotsTable.$inferSelect;
