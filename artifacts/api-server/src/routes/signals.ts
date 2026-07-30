import { Router } from "express";
import { desc, inArray } from "drizzle-orm";
import { db, signalsTable } from "@workspace/db";
import { CreateSignalBody } from "@workspace/api-zod";

const router = Router();

const serializeSignal = (s: typeof signalsTable.$inferSelect) => ({
  ...s,
  obHigh: s.obHigh != null ? Number(s.obHigh) : null,
  obLow: s.obLow != null ? Number(s.obLow) : null,
  volumeZScore: s.volumeZScore != null ? Number(s.volumeZScore) : null,
  createdAt: s.createdAt.toISOString(),
});

// GET /signals
router.get("/signals", async (req, res): Promise<void> => {
  const signals = await db
    .select()
    .from(signalsTable)
    .orderBy(desc(signalsTable.createdAt))
    .limit(100);
  res.json(signals.map(serializeSignal));
});

// GET /signals/active
router.get("/signals/active", async (req, res): Promise<void> => {
  const active = await db
    .select()
    .from(signalsTable)
    .where(inArray(signalsTable.state, ["BULL_EXEC", "BEAR_EXEC", "IN_HTF_POI"]))
    .orderBy(desc(signalsTable.createdAt))
    .limit(20);
  res.json(active.map(serializeSignal));
});

// POST /signals
router.post("/signals", async (req, res): Promise<void> => {
  const parsed = CreateSignalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { data } = parsed;
  const [inserted] = await db
    .insert(signalsTable)
    .values({
      asset: data.asset,
      chain: data.chain,
      state: data.state,
      ltfMessage: data.ltfMessage,
      htfMessage: data.htfMessage,
      obHigh: data.obHigh != null ? String(data.obHigh) : null,
      obLow: data.obLow != null ? String(data.obLow) : null,
      volumeZScore: data.volumeZScore != null ? String(data.volumeZScore) : null,
    })
    .returning();
  res.status(201).json(serializeSignal(inserted));
});

export default router;
