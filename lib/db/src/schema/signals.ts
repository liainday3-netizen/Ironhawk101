import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  asset: text("asset").notNull(),
  chain: text("chain").notNull(),
  state: text("state").notNull(), // BULL_EXEC | BEAR_EXEC | IN_HTF_POI | OUT_OF_SESSION | FILTERED_BIAS | WAITING
  ltfMessage: text("ltf_message").notNull(),
  htfMessage: text("htf_message").notNull(),
  obHigh: numeric("ob_high", { precision: 20, scale: 8 }),
  obLow: numeric("ob_low", { precision: 20, scale: 8 }),
  volumeZScore: numeric("volume_z_score", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
