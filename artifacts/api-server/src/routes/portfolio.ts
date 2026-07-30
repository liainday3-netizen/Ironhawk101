import { Router } from "express";
import { desc } from "drizzle-orm";
import { db, tradesTable, capitalSnapshotsTable } from "@workspace/db";
import { CreateCapitalSnapshotBody } from "@workspace/api-zod";

const router = Router();

// GET /portfolio/summary
router.get("/portfolio/summary", async (req, res): Promise<void> => {
  const trades = await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt));

  const startingCapitalUsd = 10;
  let totalPnlUsd = 0;
  let winCount = 0;
  let closedTrades = 0;

  // Chain breakdown accumulator
  const chainMap: Record<string, number> = {
    solana: 0,
    ethereum: 0,
    base: 0,
    bitcoin: 0,
  };

  for (const t of trades) {
    const pnl = t.pnlUsd != null ? Number(t.pnlUsd) : 0;
    totalPnlUsd += pnl;
    if (t.exitPriceUsd != null) {
      closedTrades++;
      if (pnl > 0) winCount++;
    }
    chainMap[t.chain] = (chainMap[t.chain] ?? 0) + Number(t.amountUsd);
  }

  const currentCapitalUsd = startingCapitalUsd + totalPnlUsd;
  const roiPercent = ((currentCapitalUsd - startingCapitalUsd) / startingCapitalUsd) * 100;
  const winRate = closedTrades > 0 ? (winCount / closedTrades) * 100 : 0;

  const totalAllocated = Object.values(chainMap).reduce((a, b) => a + b, 0) || 1;
  const chainBreakdown = Object.entries(chainMap).map(([chain, balanceUsd]) => ({
    chain,
    balanceUsd,
    allocation: (balanceUsd / totalAllocated) * 100,
  }));

  res.json({
    startingCapitalUsd,
    currentCapitalUsd,
    totalPnlUsd,
    roiPercent,
    totalTrades: trades.length,
    winRate,
    chainBreakdown,
  });
});

// GET /portfolio/snapshots
router.get("/portfolio/snapshots", async (req, res): Promise<void> => {
  const snapshots = await db
    .select()
    .from(capitalSnapshotsTable)
    .orderBy(desc(capitalSnapshotsTable.createdAt))
    .limit(90);
  res.json(
    snapshots.map((s) => ({
      ...s,
      totalUsd: Number(s.totalUsd),
      solBalanceUsd: s.solBalanceUsd != null ? Number(s.solBalanceUsd) : null,
      ethBalanceUsd: s.ethBalanceUsd != null ? Number(s.ethBalanceUsd) : null,
      baseBalanceUsd: s.baseBalanceUsd != null ? Number(s.baseBalanceUsd) : null,
      btcBalanceUsd: s.btcBalanceUsd != null ? Number(s.btcBalanceUsd) : null,
      createdAt: s.createdAt.toISOString(),
    }))
  );
});

// POST /portfolio/snapshots
router.post("/portfolio/snapshots", async (req, res): Promise<void> => {
  const parsed = CreateCapitalSnapshotBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { data } = parsed;
  const [inserted] = await db
    .insert(capitalSnapshotsTable)
    .values({
      totalUsd: String(data.totalUsd),
      solBalanceUsd: data.solBalanceUsd != null ? String(data.solBalanceUsd) : null,
      ethBalanceUsd: data.ethBalanceUsd != null ? String(data.ethBalanceUsd) : null,
      baseBalanceUsd: data.baseBalanceUsd != null ? String(data.baseBalanceUsd) : null,
      btcBalanceUsd: data.btcBalanceUsd != null ? String(data.btcBalanceUsd) : null,
    })
    .returning();
  res.status(201).json({
    ...inserted,
    totalUsd: Number(inserted.totalUsd),
    solBalanceUsd: inserted.solBalanceUsd != null ? Number(inserted.solBalanceUsd) : null,
    ethBalanceUsd: inserted.ethBalanceUsd != null ? Number(inserted.ethBalanceUsd) : null,
    baseBalanceUsd: inserted.baseBalanceUsd != null ? Number(inserted.baseBalanceUsd) : null,
    btcBalanceUsd: inserted.btcBalanceUsd != null ? Number(inserted.btcBalanceUsd) : null,
    createdAt: inserted.createdAt.toISOString(),
  });
});

export default router;
