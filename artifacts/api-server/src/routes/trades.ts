import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { db, tradesTable } from "@workspace/db";
import {
  CreateTradeBody,
  DeleteTradeParams,
} from "@workspace/api-zod";

const router = Router();

// GET /trades
router.get("/trades", async (req, res): Promise<void> => {
  const trades = await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt));
  res.json(
    trades.map((t) => ({
      ...t,
      entryPriceUsd: Number(t.entryPriceUsd),
      exitPriceUsd: t.exitPriceUsd != null ? Number(t.exitPriceUsd) : null,
      amountUsd: Number(t.amountUsd),
      pnlUsd: t.pnlUsd != null ? Number(t.pnlUsd) : null,
      pnlPercent: t.pnlPercent != null ? Number(t.pnlPercent) : null,
      createdAt: t.createdAt.toISOString(),
    }))
  );
});

// GET /trades/recent
router.get("/trades/recent", async (req, res): Promise<void> => {
  const trades = await db
    .select()
    .from(tradesTable)
    .orderBy(desc(tradesTable.createdAt))
    .limit(10);
  res.json(
    trades.map((t) => ({
      ...t,
      entryPriceUsd: Number(t.entryPriceUsd),
      exitPriceUsd: t.exitPriceUsd != null ? Number(t.exitPriceUsd) : null,
      amountUsd: Number(t.amountUsd),
      pnlUsd: t.pnlUsd != null ? Number(t.pnlUsd) : null,
      pnlPercent: t.pnlPercent != null ? Number(t.pnlPercent) : null,
      createdAt: t.createdAt.toISOString(),
    }))
  );
});

// POST /trades
router.post("/trades", async (req, res): Promise<void> => {
  const parsed = CreateTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { data } = parsed;
  const [inserted] = await db
    .insert(tradesTable)
    .values({
      chain: data.chain,
      tokenSymbol: data.tokenSymbol,
      tokenAddress: data.tokenAddress ?? null,
      side: data.side,
      entryPriceUsd: String(data.entryPriceUsd),
      exitPriceUsd: data.exitPriceUsd != null ? String(data.exitPriceUsd) : null,
      amountUsd: String(data.amountUsd),
      pnlUsd: data.pnlUsd != null ? String(data.pnlUsd) : null,
      pnlPercent: data.pnlPercent != null ? String(data.pnlPercent) : null,
      txHash: data.txHash,
      signalState: data.signalState ?? null,
    })
    .returning();
  res.status(201).json({
    ...inserted,
    entryPriceUsd: Number(inserted.entryPriceUsd),
    exitPriceUsd: inserted.exitPriceUsd != null ? Number(inserted.exitPriceUsd) : null,
    amountUsd: Number(inserted.amountUsd),
    pnlUsd: inserted.pnlUsd != null ? Number(inserted.pnlUsd) : null,
    pnlPercent: inserted.pnlPercent != null ? Number(inserted.pnlPercent) : null,
    createdAt: inserted.createdAt.toISOString(),
  });
});

// DELETE /trades/:id
router.delete("/trades/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = DeleteTradeParams.safeParse({ id: Number(rawId) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid trade id" });
    return;
  }
  await db.delete(tradesTable).where(eq(tradesTable.id, parsed.data.id));
  res.status(204).send();
});

export default router;
