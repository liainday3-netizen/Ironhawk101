/**
 * IronHawk Trade Executor
 * Bridges the microstructure signal engine → on-chain execution.
 */

import { db, positionsTable, watchedPairsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { calculatePositionSize, recordTradeResult, canOpenPosition } from "./capitalScaling";
import { executeBuyEVM, executeSellEVM, getWalletAddress } from "./evmExecutor";
import { executeBuySolana, executeSellSolana, getSolanaWalletAddress } from "./solanaExecutor";
import { getSolanaTokenDecimals } from "./solanaExecutor";
import { getTradingConfigurationError } from "./tradingGuard";
import type { Address } from "viem";

export interface ExecuteSignalOptions {
  pairId: number;
  direction: "BUY" | "SELL";
  tokenAddress: string;
  tokenDecimals?: number;
  obHigh: number;
  obLow: number;
  ltfMessage: string;
  signalId?: number;
  marketRegime?: string;
  confidenceScore?: number;
  liquidityScore?: number;
  suggestedStopLossPct?: number;
  executionGuard?: string;
}

export async function executeSignal(opts: ExecuteSignalOptions): Promise<{
  success: boolean;
  positionId?: number;
  txHash?: string;
  error?: string;
  positionSizeUsd?: number;
}> {
  const pair = await db
    .select()
    .from(watchedPairsTable)
    .where(eq(watchedPairsTable.id, opts.pairId))
    .then((r) => r[0]);

  if (!pair) return { success: false, error: "Pair not found" };

  const chain = pair.chain;
  if (!["ethereum", "base", "solana"].includes(chain)) {
    return { success: false, error: `Unsupported execution chain: ${chain}` };
  }
  const expectedTokenAddress = pair.baseTokenAddress?.trim();
  if (!expectedTokenAddress) {
    return { success: false, error: "Pair has no verified base token address" };
  }

  const tokenMatches =
    chain === "solana"
      ? opts.tokenAddress === expectedTokenAddress
      : opts.tokenAddress.toLowerCase() === expectedTokenAddress.toLowerCase();
  if (!tokenMatches) {
    return { success: false, error: "Token address does not match the watched pair" };
  }

  const tradingConfigError = getTradingConfigurationError();
  if (tradingConfigError) {
    return { success: false, error: tradingConfigError };
  }

  // This is a spot DEX terminal. A BEAR signal closes an existing long; it
  // must never submit a zero-amount sell or pretend to open a short.
  if (opts.direction === "SELL") {
    const openPositions = await db
      .select()
      .from(positionsTable)
      .where(and(
        eq(positionsTable.pairId, opts.pairId),
        inArray(positionsTable.status, ["OPEN", "PARTIAL"]),
      ))
      .limit(1);
    if (openPositions.length === 0) {
      return { success: false, error: "No open spot position to sell" };
    }
    const closed = await closePosition(openPositions[0].id, 100);
    return {
      success: closed.success,
      txHash: closed.txHash,
      error: closed.error,
    };
  }

  const { allowed, reason } = await canOpenPosition(chain);
  if (!allowed) return { success: false, error: reason };

  const sizing = await calculatePositionSize(chain, {
    marketRegime: opts.marketRegime,
    confidenceScore: opts.confidenceScore,
    liquidityScore: opts.liquidityScore,
    suggestedStopLossPct: opts.suggestedStopLossPct,
    executionAllowed: opts.executionGuard === "ADAPTIVE_GUARDS_CLEAR",
    executionGuard: opts.executionGuard,
  });
  if (sizing.riskPct <= 0) {
    return { success: false, error: opts.executionGuard ?? "Adaptive risk is zero" };
  }
  const walletAddress = chain === "solana"
    ? await getSolanaWalletAddress()
    : await getWalletAddress(chain);

  if (!walletAddress) {
    return { success: false, error: `No wallet configured for ${chain}. Set ${chain === "solana" ? "SOLANA_WALLET_PRIVATE_KEY" : "EVM_WALLET_PRIVATE_KEY"} in Secrets.` };
  }

  let txResult;
  if (chain === "solana") {
    txResult = await executeBuySolana(expectedTokenAddress, sizing.positionSizeUsd);
  } else {
    txResult = await executeBuyEVM(chain, expectedTokenAddress as Address, sizing.positionSizeUsd);
  }

  const [position] = await db
    .insert(positionsTable)
    .values({
      pairId: opts.pairId,
      signalId: opts.signalId ?? null,
      symbol: pair.symbol,
      chain,
      dex: pair.dex,
      direction: opts.direction,
      status: txResult.success ? "OPEN" : "FAILED",
      entryPrice: pair.currentPrice,
      entryAmountUsd: sizing.positionSizeUsd,
      tokenAmountIn: txResult.amountIn,
      tokenAmountOut: txResult.amountOut,
      entryTxHash: txResult.txHash ?? null,
      capitalAtEntry: sizing.capitalAtEntry,
      riskPct: sizing.riskPct,
      obHigh: opts.obHigh,
      obLow: opts.obLow,
      stopLossPrice: pair.currentPrice * (1 - (opts.suggestedStopLossPct ?? sizing.stopLossPct) / 100),
      stopLossPct: opts.suggestedStopLossPct ?? sizing.stopLossPct,
      tpLevels: JSON.stringify(sizing.tpLevels),
      walletAddress,
      notes: `Auto-executed: ${opts.ltfMessage} | Tier: ${sizing.scalingTier} | Regime: ${opts.marketRegime ?? "UNKNOWN"} | Confidence: ${opts.confidenceScore ?? 0}`,
    })
    .returning();

  if (txResult.success) {
    logger.info(
      { positionId: position.id, chain, direction: opts.direction, sizeUsd: sizing.positionSizeUsd },
      "Position opened successfully"
    );
  }

  return {
    success: txResult.success,
    positionId: position.id,
    txHash: txResult.txHash,
    error: txResult.error,
    positionSizeUsd: sizing.positionSizeUsd,
  };
}

export async function closePosition(
  positionId: number,
  pctToClose: number = 100
): Promise<{ success: boolean; pnlUsd?: number; txHash?: string; error?: string }> {
  const position = await db
    .select()
    .from(positionsTable)
    .where(eq(positionsTable.id, positionId))
    .then((r) => r[0]);

  if (!position) return { success: false, error: "Position not found" };
  if (position.status === "CLOSED") return { success: false, error: "Position already closed" };

  const pair = await db
    .select()
    .from(watchedPairsTable)
    .where(eq(watchedPairsTable.id, position.pairId))
    .then((r) => r[0]);

  const currentPrice = pair?.currentPrice ?? 0;
  const amountToClose = (position.tokenAmountOut ?? 0) * (pctToClose / 100);
  if (!Number.isFinite(amountToClose) || amountToClose <= 0) {
    return { success: false, error: "Position has no sellable token amount" };
  }

  let txResult;
  if (position.chain === "solana") {
    if (!pair?.baseTokenAddress) {
      return { success: false, error: "Pair has no verified base token address" };
    }
    const tokenDecimals = await getSolanaTokenDecimals(pair.baseTokenAddress);
    if (tokenDecimals === null) {
      return { success: false, error: "Could not verify Solana token decimals" };
    }
    txResult = await executeSellSolana(pair.baseTokenAddress, tokenDecimals, amountToClose);
  } else {
    if (!pair?.baseTokenAddress) {
      return { success: false, error: "Pair has no verified base token address" };
    }
    txResult = await executeSellEVM(
      position.chain,
      pair.baseTokenAddress as Address,
      amountToClose,
    );
  }

  if (!txResult.success) {
    return {
      success: false,
      txHash: txResult.txHash,
      error: txResult.error ?? "On-chain close failed",
    };
  }

  const exitAmountUsd = txResult.amountOut || currentPrice * amountToClose;
  const pnlUsd = exitAmountUsd - ((position.entryAmountUsd ?? 0) * pctToClose / 100);
  const pnlPct = (position.entryAmountUsd ?? 0) > 0
    ? (pnlUsd / ((position.entryAmountUsd ?? 0) * pctToClose / 100)) * 100
    : 0;
  const isFull = pctToClose >= 100;

  await db
    .update(positionsTable)
    .set({
      status: isFull ? "CLOSED" : "PARTIAL",
      exitPrice: currentPrice,
      exitAmountUsd,
      exitTxHash: txResult.txHash ?? null,
      realizedPnlUsd: (position.realizedPnlUsd ?? 0) + pnlUsd,
      realizedPnlPct: pnlPct,
      closedAt: isFull ? new Date() : null,
      lastUpdatedAt: new Date(),
    })
    .where(eq(positionsTable.id, positionId));

  if (isFull) {
    await recordTradeResult(position.chain, pnlUsd, pnlUsd > 0);
  }

  logger.info({ positionId, pctToClose, pnlUsd, pnlPct }, "Position closed");
  return { success: true, pnlUsd, txHash: txResult.txHash };
}

export async function monitorPositions(): Promise<void> {
  const tradingConfigError = getTradingConfigurationError();
  if (tradingConfigError) {
    logger.warn({ reason: tradingConfigError }, "Position monitor paused");
    return;
  }

  const openPositions = await db
    .select()
    .from(positionsTable)
    .where(eq(positionsTable.status, "OPEN"));

  for (const pos of openPositions) {
    const pair = await db
      .select()
      .from(watchedPairsTable)
      .where(eq(watchedPairsTable.id, pos.pairId))
      .then((r) => r[0]);

    if (!pair) continue;
    const currentPrice = pair.currentPrice;
    if (!currentPrice) continue;

    const priceMultiplier = pos.direction === "BUY"
      ? currentPrice / pos.entryPrice
      : pos.entryPrice / currentPrice;

    if (pos.stopLossPrice !== null) {
      const slHit = pos.direction === "BUY"
        ? currentPrice <= pos.stopLossPrice
        : currentPrice >= pos.stopLossPrice;

      if (slHit) {
        logger.warn({ positionId: pos.id, currentPrice, sl: pos.stopLossPrice }, "Stop loss triggered");
        await closePosition(pos.id, 100);
        continue;
      }
    }

    if (pos.tpLevels) {
      const levels: Array<{ pct: number; multiplier: number; hit: boolean }> = JSON.parse(pos.tpLevels);
      let updated = false;

      for (const level of levels) {
        if (!level.hit && priceMultiplier >= level.multiplier) {
          logger.info({ positionId: pos.id, multiplier: level.multiplier, pct: level.pct }, "Take profit hit");
          await closePosition(pos.id, level.pct);
          level.hit = true;
          updated = true;
        }
      }

      if (updated) {
        const allHit = levels.every((l) => l.hit);
        await db
          .update(positionsTable)
          .set({
            tpLevels: JSON.stringify(levels),
            status: allHit ? "CLOSED" : "PARTIAL",
            closedAt: allHit ? new Date() : null,
            lastUpdatedAt: new Date(),
          })
          .where(eq(positionsTable.id, pos.id));
      }
    }
  }
}
