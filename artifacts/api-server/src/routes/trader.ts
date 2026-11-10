import { Router } from "express";
import { db, positionsTable, capitalConfigTable } from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import {
  getOrCreateCapitalConfig,
  getPerformanceSummary,
  calculatePositionSize,
  MIN_CAPITAL_USD,
} from "../lib/capitalScaling";
import { executeSignal, closePosition, reconcilePendingPositions } from "../lib/tradeExecutor";
import { requireTradingAccess } from "../middlewares/auth";
import { getTradingConfigurationError, getCloseTradingConfigurationError } from "../lib/tradingGuard";

const router = Router();

// GET /trader/positions
router.get("/trader/positions", requireTradingAccess, async (req, res) => {
  const status = String(req.query.status ?? "all");
  const chain = String(req.query.chain ?? "all");
  const pairId = req.query.pairId === undefined ? undefined : Number(req.query.pairId);

  if (pairId !== undefined && (!Number.isInteger(pairId) || pairId <= 0)) {
    res.status(400).json({ error: "pairId must be a positive integer" });
    return;
  }

  const conditions: any[] = [];
  if (status !== "all") conditions.push(eq(positionsTable.status, status));
  if (chain !== "all") conditions.push(eq(positionsTable.chain, chain));
  if (pairId !== undefined) conditions.push(eq(positionsTable.pairId, pairId));

  const positions = await db
    .select()
    .from(positionsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${positionsTable.openedAt} DESC`)
    .limit(200);

  res.json(
    positions.map((p) => ({
      id: p.id,
      pairId: p.pairId,
      signalId: p.signalId ?? null,
      symbol: p.symbol,
      chain: p.chain,
      dex: p.dex,
      direction: p.direction,
      status: p.status,
      entryPrice: p.entryPrice,
      entryAmountUsd: p.entryAmountUsd,
      tokenAmountIn: p.tokenAmountIn,
      tokenAmountOut: p.tokenAmountOut,
      remainingTokenAmountRaw: p.remainingTokenAmountRaw ?? null,
      tokenDecimals: p.tokenDecimals ?? null,
      remainingCostBasisUsd: p.remainingCostBasisUsd ?? null,
      entryTxHash: p.entryTxHash ?? null,
      capitalAtEntry: p.capitalAtEntry,
      riskPct: p.riskPct,
      exitPrice: p.exitPrice ?? null,
      exitAmountUsd: p.exitAmountUsd ?? null,
      exitTxHash: p.exitTxHash ?? null,
      realizedPnlUsd: p.realizedPnlUsd ?? null,
      realizedPnlPct: p.realizedPnlPct ?? null,
      tpLevels: p.tpLevels ?? null,
      stopLossPrice: p.stopLossPrice ?? null,
      stopLossPct: p.stopLossPct ?? null,
      obHigh: p.obHigh ?? null,
      obLow: p.obLow ?? null,
      walletAddress: p.walletAddress ?? null,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt?.toISOString() ?? null,
      notes: p.notes ?? null,
    }))
  );
});

router.get("/trader/trading-status", requireTradingAccess, (_req, res) => {
  const newTradeReason = getTradingConfigurationError();
  const closeReason = getCloseTradingConfigurationError();
  res.json({
    newTradesEnabled: newTradeReason === null,
    closesEnabled: closeReason === null,
    newTradeReason,
    closeReason,
  });
});

// POST /trader/reconcile — sweep positions whose entry was broadcast but never
// verified. Safe to call at any time; does nothing when there is no residue.
router.post("/trader/reconcile", requireTradingAccess, async (_req, res) => {
  const result = await reconcilePendingPositions();
  res.json(result);
});

// POST /trader/positions/:id/close
router.post("/trader/positions/:id/close", requireTradingAccess, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid position id" });
    return;
  }
  const pctToClose = Number(req.body?.pctToClose ?? 100);
  if (!Number.isFinite(pctToClose) || pctToClose < 1 || pctToClose > 100) {
    res.status(400).json({ error: "pctToClose must be 1–100" });
    return;
  }
  const closeConfigurationError = getCloseTradingConfigurationError();
  if (closeConfigurationError) {
    res.status(503).json({ error: closeConfigurationError });
    return;
  }

  const existing = await db.select().from(positionsTable).where(eq(positionsTable.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: "Position not found" });
    return;
  }

  const result = await closePosition(id, pctToClose);
  res.json({
    success: result.success,
    pnlUsd: result.pnlUsd ?? null,
    txHash: result.txHash ?? null,
    error: result.error ?? null,
  });
});

// POST /trader/execute
router.post("/trader/execute", requireTradingAccess, async (req, res) => {
  const { pairId, direction, tokenAddress } = req.body ?? {};
  const parsedPairId = Number(pairId);
  const normalizedDirection = String(direction ?? "").toUpperCase();
  const normalizedTokenAddress = typeof tokenAddress === "string" ? tokenAddress.trim() : "";

  if (
    !Number.isInteger(parsedPairId) ||
    parsedPairId <= 0 ||
    !["BUY", "SELL"].includes(normalizedDirection) ||
    !normalizedTokenAddress
  ) {
    res.status(400).json({ error: "pairId, direction, tokenAddress are required" });
    return;
  }

  const result = await executeSignal({
    pairId: parsedPairId,
    direction: normalizedDirection as "BUY" | "SELL",
    tokenAddress: normalizedTokenAddress,
    obHigh: 0,
    obLow: 0,
    ltfMessage: "Manual execution",
  });

  res.json({
    success: result.success,
    positionId: result.positionId ?? null,
    txHash: result.txHash ?? null,
    positionSizeUsd: result.positionSizeUsd ?? null,
    error: result.error ?? null,
  });
});

// GET /trader/capital
router.get("/trader/capital", requireTradingAccess, async (_req, res) => {
  const summary = await getPerformanceSummary();
  if (summary.length === 0) {
    await Promise.all([
      getOrCreateCapitalConfig("ethereum"),
      getOrCreateCapitalConfig("base"),
      getOrCreateCapitalConfig("solana"),
    ]);
    const fresh = await getPerformanceSummary();
    res.json(fresh);
    return;
  }
  res.json(summary);
});

// PATCH /trader/capital
router.patch("/trader/capital", requireTradingAccess, async (req, res) => {
  const { chain, ...updates } = req.body ?? {};
  const normalizedChain = typeof chain === "string" ? chain.toLowerCase() : "";
  if (!["ethereum", "base", "solana"].includes(normalizedChain)) {
    res.status(400).json({ error: "chain is required" });
    return;
  }

  const numericFields = [
    "initialCapitalUsd",
    "riskPct",
    "maxRiskPct",
    "stopLossPct",
    "maxPositionUsd",
    "maxConcurrentPositions",
  ] as const;
  for (const field of numericFields) {
    if (
      updates[field] !== undefined &&
      (!Number.isFinite(Number(updates[field])) || Number(updates[field]) < 0)
    ) {
      res.status(400).json({ error: `${field} must be a non-negative number` });
      return;
    }
  }

  if (
    updates.initialCapitalUsd !== undefined &&
    (Number(updates.initialCapitalUsd) < MIN_CAPITAL_USD ||
      Number(updates.initialCapitalUsd) > 1_000_000)
  ) {
    res.status(400).json({
      error: `initialCapitalUsd must be between $${MIN_CAPITAL_USD} and $1,000,000`,
    });
    return;
  }

  if (updates.riskPct !== undefined && Number(updates.riskPct) > 10) {
    res.status(400).json({ error: "riskPct cannot exceed 10" });
    return;
  }
  if (updates.maxRiskPct !== undefined && Number(updates.maxRiskPct) > 10) {
    res.status(400).json({ error: "maxRiskPct cannot exceed 10" });
    return;
  }
  if (updates.stopLossPct !== undefined && Number(updates.stopLossPct) > 100) {
    res.status(400).json({ error: "stopLossPct cannot exceed 100" });
    return;
  }
  if (updates.maxPositionUsd !== undefined && Number(updates.maxPositionUsd) > 1_000_000) {
    res.status(400).json({ error: "maxPositionUsd cannot exceed $1,000,000" });
    return;
  }
  if (
    updates.maxConcurrentPositions !== undefined &&
    (!Number.isInteger(Number(updates.maxConcurrentPositions)) ||
      Number(updates.maxConcurrentPositions) < 1 ||
      Number(updates.maxConcurrentPositions) > 8)
  ) {
    res.status(400).json({ error: "maxConcurrentPositions must be an integer from 1 to 8" });
    return;
  }

  if (updates.autoExecute !== undefined && typeof updates.autoExecute !== "boolean") {
    res.status(400).json({ error: "autoExecute must be a boolean" });
    return;
  }
  if (
    updates.walletAddress !== undefined &&
    (typeof updates.walletAddress !== "string" || updates.walletAddress.length > 128)
  ) {
    res.status(400).json({ error: "walletAddress must be a string no longer than 128 characters" });
    return;
  }

  if (updates.autoExecute === true && getTradingConfigurationError()) {
    res.status(503).json({
      error: getTradingConfigurationError(),
    });
    return;
  }

  const config = await getOrCreateCapitalConfig(normalizedChain);
  const setValues: Partial<typeof capitalConfigTable.$inferInsert> = { updatedAt: new Date() };

  if (updates.initialCapitalUsd !== undefined) {
    setValues.initialCapitalUsd = Number(updates.initialCapitalUsd);
    if (config.totalTradeCount === 0) {
      setValues.currentCapitalUsd = Number(updates.initialCapitalUsd);
    }
  }
  if (updates.riskPct !== undefined) setValues.riskPct = Number(updates.riskPct);
  if (updates.maxRiskPct !== undefined) setValues.maxRiskPct = Number(updates.maxRiskPct);
  if (updates.stopLossPct !== undefined) setValues.stopLossPct = Number(updates.stopLossPct);
  if (updates.maxPositionUsd !== undefined) setValues.maxPositionUsd = Number(updates.maxPositionUsd);
  if (updates.maxConcurrentPositions !== undefined) setValues.maxConcurrentPositions = Number(updates.maxConcurrentPositions);
  if (updates.autoExecute !== undefined) setValues.autoExecute = updates.autoExecute;
  if (updates.walletAddress !== undefined) setValues.walletAddress = updates.walletAddress;

  await db
    .update(capitalConfigTable)
    .set(setValues)
    .where(eq(capitalConfigTable.chain, normalizedChain));

  const summary = await getPerformanceSummary(normalizedChain);
  res.json(summary[0]);
});

// GET /trader/performance
router.get("/trader/performance", requireTradingAccess, async (_req, res) => {
  const chains = await getPerformanceSummary();

  const totalPnlUsd = chains.reduce((s, c) => s + c.totalPnlUsd, 0);
  const totalInitial = chains.reduce((s, c) => s + c.initialCapital, 0);
  const totalReturnPct = totalInitial > 0 ? (totalPnlUsd / totalInitial) * 100 : 0;
  const totalTrades = chains.reduce((s, c) => s + c.totalTrades, 0);
  const totalWins = chains.reduce((s, c) => s + c.wins, 0);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

  const openCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(positionsTable)
    .where(inArray(positionsTable.status, ["OPEN", "PARTIAL"]));

  // Surface unresolved positions distinctly. These are executions whose result
  // was never verified, so they are excluded from realised P&L above and must
  // not be mistaken for clean open exposure.
  const unresolvedCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(positionsTable)
    .where(eq(positionsTable.status, "RECONCILIATION_REQUIRED"));

  const bestChain = chains.length > 0
    ? chains.sort((a, b) => b.totalReturnPct - a.totalReturnPct)[0].chain
    : null;

  res.json({
    chains,
    totalPnlUsd,
    totalReturnPct,
    totalTrades,
    winRate,
    openPositions: openCount[0]?.count ?? 0,
    reconciliationRequired: unresolvedCount[0]?.count ?? 0,
    bestChain,
  });
});

export default router;
