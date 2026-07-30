import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, watchlistTable } from "@workspace/db";
import { AddWatchlistItemBody, RemoveWatchlistItemParams } from "@workspace/api-zod";

const router = Router();

const serializeItem = (w: typeof watchlistTable.$inferSelect) => ({
  ...w,
  addedAt: w.addedAt.toISOString(),
});

// GET /watchlist
router.get("/watchlist", async (req, res): Promise<void> => {
  const items = await db.select().from(watchlistTable).orderBy(watchlistTable.addedAt);
  res.json(items.map(serializeItem));
});

// POST /watchlist
router.post("/watchlist", async (req, res): Promise<void> => {
  const parsed = AddWatchlistItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { data } = parsed;
  const [inserted] = await db
    .insert(watchlistTable)
    .values({
      chain: data.chain,
      tokenSymbol: data.tokenSymbol,
      tokenAddress: data.tokenAddress,
      notes: data.notes ?? null,
    })
    .returning();
  res.status(201).json(serializeItem(inserted));
});

// DELETE /watchlist/:id
router.delete("/watchlist/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = RemoveWatchlistItemParams.safeParse({ id: Number(rawId) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid watchlist item id" });
    return;
  }
  await db.delete(watchlistTable).where(eq(watchlistTable.id, parsed.data.id));
  res.status(204).send();
});

export default router;
