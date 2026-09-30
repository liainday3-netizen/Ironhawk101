/**
 * IronHawk Trade Executor
 * Bridges the microstructure signal engine → on-chain execution.
 */

import { db, positionsTable, watchedPairsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { calculatePositionSize, recordTradeResult, canOpenPosition } from "./capitalScaling";
import {
  executeBuyEVM,
  executeSellEVM,
  getEvmTokenDecimals,
  getWalletAddress,
} from "./evmExecutor";
import { executeBuySolana, executeSellSolana, getSolanaWalletAddress } from "./solanaExecutor";
import { getSolanaTokenDecimals } from "./solanaExecutor";
import {
  getCloseTradingConfigurationError,
  getTradingConfigurationError,
} from "./tradingGuard";
import { getPairInfo } from "./marketData";
import { acquireAdvisoryLock } from "./advisoryLock";
import type { Address } from "viem";

const TRADE_LOCK_NAMESPACE = 4242;
const MAX_SIGNAL_AGE_MS = 90_000;
const MAX_ENTRY_PRICE_DRIFT_PCT = 2;

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
  const release = await acquireAdvisoryLock(TRADE_LOCK_NAMESPACE, 1);
  if (!release) {
    return { success: false, error: "Another trade is in progress; retry after it completes" };
  }
  try {
    return await executeSignalLocked(opts);
  } finally {
    await release();
  }
}

async function executeSignalLocked(opts: ExecuteSignalOptions): Promise<{
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

  const tradingConfigError = opts.direction === "BUY"
    ? getTradingConfigurationError()
    : getCloseTradingConfigurationError();
  if (tradingConfigError) {
    return { success: false, error: tradingConfigError };
  }

  const scannedAt = pair.lastScannedAt?.getTime() ?? 0;
  const scanAgeMs = Date.now() - scannedAt;
  if (scanAgeMs < 0 || scanAgeMs > MAX_SIGNAL_AGE_MS) {
    return { success: false, error: "Market signal is stale; wait for a fresh scanner update" };
  }
  if (
    pair.executionGuard !== "ADAPTIVE_GUARDS_CLEAR" ||
    !Number.isFinite(pair.currentPrice) ||
    pair.currentPrice <= 0
  ) {
    return {
      success: false,
      error: pair.executionGuard || "Pair is blocked by the market safety checks",
    };
  }

  const requiredState = opts.direction === "BUY" ? "BULL_EXEC" : "BEAR_EXEC";
  if (pair.state !== requiredState) {
    return { success: false, error: `Fresh ${requiredState} signal required for ${opts.direction}` };
  }

  // Recheck the DEX listing at execution time. A watched pair may have changed
  // its base token, lost liquidity, or stopped returning current market data.
  const market = await getPairInfo(pair.pairAddress, chain);
  if (
    !market ||
    !Number.isFinite(market.price) ||
    market.price <= 0 ||
    !Number.isFinite(market.liquidity) ||
    market.liquidity < 100_000
  ) {
    return { success: false, error: "Fresh market data or minimum $100,000 liquidity check failed" };
  }
  const marketTokenMatches = chain === "solana"
    ? market.baseTokenAddress === expectedTokenAddress
    : market.baseTokenAddress.toLowerCase() === expectedTokenAddress.toLowerCase();
  if (!marketTokenMatches) {
    return { success: false, error: "Live DEX base token does not match the watched token" };
  }
  const priceDriftPct = Math.abs(market.price - pair.currentPrice) / pair.currentPrice * 100;
  if (priceDriftPct > MAX_ENTRY_PRICE_DRIFT_PCT) {
    return { success: false, error: "Market moved more than 2% since the last scan; trade blocked" };
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

  const { allowed, reason } = await canOpenPosition(chain, {
    requireAutoExecute: opts.signalId !== undefined,
  });
  if (!allowed) return { success: false, error: reason };

  const sizing = await calculatePositionSize(chain, {
    marketRegime: pair.marketRegime,
    confidenceScore: pair.confidenceScore,
    liquidityScore: pair.liquidityScore,
    suggestedStopLossPct: pair.adaptiveStopLossPct,
    executionAllowed: true,
    executionGuard: pair.executionGuard,
  });
  if (sizing.riskPct <= 0) {
    return { success: false, error: pair.executionGuard ?? "Adaptive risk is zero" };
  }
  const positionSizeUsd = Math.min(sizing.positionSizeUsd, 1_000);
  const walletAddress = chain === "solana"
    ? await getSolanaWalletAddress()
    : await getWalletAddress(chain);

  if (!walletAddress) {
    return { success: false, error: `No wallet configured for ${chain}. Set ${chain === "solana" ? "SOLANA_WALLET_PRIVATE_KEY" : "EVM_WALLET_PRIVATE_KEY"} in Secrets.` };
  }

  let txResult;
  if (chain === "solana") {
    txResult = await executeBuySolana(expectedTokenAddress, positionSizeUsd);
  } else {
    txResult = await executeBuyEVM(chain, expectedTokenAddress as Address, positionSizeUsd);
  }

  const stopLossPct = pair.adaptiveStopLossPct ?? sizing.stopLossPct;
  const [position] = await db
    .insert(positionsTable)
    .values({
      pairId: opts.pairId,
      signalId: opts.signalId ?? null,
      symbol: pair.symbol,
      chain,
      dex: pair.dex,
      direction: opts.direction,
      status: "EXECUTING",
      entryPrice: market.price,
      entryAmountUsd: positionSizeUsd,
      tokenAmountIn: txResult.amountIn,
      tokenAmountOut: 0,
      remainingTokenAmountRaw: null,
      remainingCostBasisUsd: positionSizeUsd,
      tokenDecimals: null,
      entryTxHash: txResult.txHash ?? null,
      capitalAtEntry: sizing.capitalAtEntry,
      riskPct: sizing.riskPct,
      obHigh: opts.obHigh,
      obLow: opts.obLow,
      stopLossPrice: market.price * (1 - stopLossPct / 100),
      stopLossPct,
      tpLevels: JSON.stringify(sizing.tpLevels),
      walletAddress,
      notes: `Auto-executed: ${opts.ltfMessage} | Tier: ${sizing.scalingTier} | Regime: ${opts.marketRegime ?? "UNKNOWN"} | Confidence: ${opts.confidenceScore ?? 0}`,
    })
    .returning();

  const hasExactOutput = Boolean(txResult.amountOutRaw) &&
    /^\d+$/.test(txResult.amountOutRaw ?? "") &&
    BigInt(txResult.amountOutRaw ?? "0") > 0n &&
    Number.isInteger(txResult.outputDecimals);
  const reconciledSuccess = txResult.success && hasExactOutput && txResult.amountOut > 0;
  const finalStatus = reconciledSuccess
    ? "OPEN"
    : txResult.txHash
      ? "RECONCILIATION_REQUIRED"
      : "FAILED";

  await db
    .update(positionsTable)
    .set({
      status: finalStatus,
      tokenAmountIn: txResult.amountIn,
      tokenAmountOut: reconciledSuccess ? txResult.amountOut : 0,
      remainingTokenAmountRaw: reconciledSuccess ? txResult.amountOutRaw! : null,
      remainingCostBasisUsd: reconciledSuccess ? positionSizeUsd : null,
      tokenDecimals: reconciledSuccess ? txResult.outputDecimals! : null,
      entryTxHash: txResult.txHash ?? null,
      lastUpdatedAt: new Date(),
    })
    .where(eq(positionsTable.id, position.id));

  if (reconciledSuccess) {
    logger.info(
      { positionId: position.id, chain, direction: opts.direction, sizeUsd: positionSizeUsd },
      "Position opened successfully"
    );
  }

  return {
    success: reconciledSuccess,
    positionId: position.id,
    txHash: txResult.txHash,
    error: reconciledSuccess
      ? undefined
      : txResult.error ?? (txResult.txHash
        ? "Transaction was submitted but its result needs reconciliation; do not retry"
        : "Trade failed before confirmation"),
    positionSizeUsd,
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
