/**
 * IronHawk Trade Executor
 * Bridges the microstructure signal engine → on-chain execution.
 *
 * Every terminal decision on a signal is recorded in `signal_outcomes`, so a
 * blocked trade leaves an explicit verdict rather than only the absence of a
 * position row. See lib/db/src/schema/signalOutcomes.ts for why that matters:
 * without it, the negative examples a model needs most cannot be told apart
 * from trades that merely have not happened yet.
 */

import { db, positionsTable, watchedPairsTable, signalOutcomesTable } from "@workspace/db";
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

export interface ExecuteSignalResult {
  success: boolean;
  positionId?: number;
  txHash?: string;
  error?: string;
  positionSizeUsd?: number;
}

type Verdict =
  | "EXECUTED"
  | "LOCK_UNAVAILABLE"
  | "PAIR_UNAVAILABLE"
  | "TRADING_DISABLED"
  | "SIGNAL_STALE"
  | "GUARD_BLOCKED"
  | "STATE_MISMATCH"
  | "MARKET_DATA_UNAVAILABLE"
  | "PRICE_DRIFT"
  | "NO_POSITION_TO_CLOSE"
  | "POSITION_LIMIT"
  | "RISK_ZERO"
  | "NO_WALLET"
  | "EXECUTION_FAILED"
  | "RECONCILIATION_REQUIRED";

/**
 * Records a decision against a signal.
 *
 * Deliberately best-effort: this is telemetry for later analysis, and a
 * failure to write it must never abort or mask the trade decision itself.
 * `signalId` is optional because manual executions have no originating signal
 * row — those are skipped rather than invented.
 */
async function recordOutcome(
  opts: ExecuteSignalOptions,
  verdict: Verdict,
  detail: {
    reason?: string;
    executed?: boolean;
    positionId?: number;
    intendedSizeUsd?: number;
    signalAgeMs?: number;
    pair?: {
      chain: string;
      price?: number | null;
      marketRegime?: string | null;
      confidenceScore?: number | null;
      liquidityScore?: number | null;
      volatilityRatio?: number | null;
      atrPct?: number | null;
      executionGuard?: string | null;
      obHigh?: number | null;
      obLow?: number | null;
    };
  } = {},
): Promise<void> {
  if (opts.signalId === undefined) return;
  try {
    await db.insert(signalOutcomesTable).values({
      signalId: opts.signalId,
      pairId: opts.pairId,
      chain: detail.pair?.chain ?? "unknown",
      direction: opts.direction,
      executed: detail.executed ? 1 : 0,
      verdict,
      reason: detail.reason ?? null,
      positionId: detail.positionId ?? null,
      intendedSizeUsd: detail.intendedSizeUsd ?? null,
      confidenceScore: detail.pair?.confidenceScore ?? opts.confidenceScore ?? null,
      liquidityScore: detail.pair?.liquidityScore ?? opts.liquidityScore ?? null,
      volatilityRatio: detail.pair?.volatilityRatio ?? null,
      atrPct: detail.pair?.atrPct ?? null,
      marketRegime: detail.pair?.marketRegime ?? opts.marketRegime ?? null,
      executionGuard: detail.pair?.executionGuard ?? opts.executionGuard ?? null,
      price: detail.pair?.price ?? null,
      obHigh: detail.pair?.obHigh ?? opts.obHigh ?? null,
      obLow: detail.pair?.obLow ?? opts.obLow ?? null,
      signalAgeMs: detail.signalAgeMs ?? null,
    });
  } catch (err) {
    logger.warn({ err, signalId: opts.signalId, verdict }, "Failed to record signal outcome");
  }
}

export async function executeSignal(opts: ExecuteSignalOptions): Promise<ExecuteSignalResult> {
  const release = await acquireAdvisoryLock(TRADE_LOCK_NAMESPACE, 1);
  if (!release) {
    const error = "Another trade is in progress; retry after it completes";
    await recordOutcome(opts, "LOCK_UNAVAILABLE", { reason: error });
    return { success: false, error };
  }
  try {
    return await executeSignalLocked(opts);
  } finally {
    await release();
  }
}

async function executeSignalLocked(opts: ExecuteSignalOptions): Promise<ExecuteSignalResult> {
  const pair = await db
    .select()
    .from(watchedPairsTable)
    .where(eq(watchedPairsTable.id, opts.pairId))
    .then((r) => r[0]);

  if (!pair) {
    const error = "Pair not found";
    await recordOutcome(opts, "PAIR_UNAVAILABLE", { reason: error });
    return { success: false, error };
  }

  // Context snapshot, reused by every outcome record below.
  const ctx = {
    chain: pair.chain,
    price: pair.currentPrice ?? null,
    marketRegime: pair.marketRegime ?? null,
    confidenceScore: pair.confidenceScore ?? null,
    liquidityScore: pair.liquidityScore ?? null,
    volatilityRatio: pair.volatilityRatio ?? null,
    atrPct: pair.atrPct ?? null,
    executionGuard: pair.executionGuard ?? null,
    obHigh: pair.obHigh ?? null,
    obLow: pair.obLow ?? null,
  };
  const fail = async (
    verdict: Verdict,
    error: string,
    extra: { signalAgeMs?: number; intendedSizeUsd?: number } = {},
  ): Promise<ExecuteSignalResult> => {
    await recordOutcome(opts, verdict, { reason: error, pair: ctx, ...extra });
    return { success: false, error };
  };

  const chain = pair.chain;
  if (!["ethereum", "base", "solana"].includes(chain)) {
    return fail("PAIR_UNAVAILABLE", `Unsupported execution chain: ${chain}`);
  }
  const expectedTokenAddress = pair.baseTokenAddress?.trim();
  if (!expectedTokenAddress) {
    return fail("PAIR_UNAVAILABLE", "Pair has no verified base token address");
  }

  const tokenMatches =
    chain === "solana"
      ? opts.tokenAddress === expectedTokenAddress
      : opts.tokenAddress.toLowerCase() === expectedTokenAddress.toLowerCase();
  if (!tokenMatches) {
    return fail("PAIR_UNAVAILABLE", "Token address does not match the watched pair");
  }

  const tradingConfigError = opts.direction === "BUY"
    ? getTradingConfigurationError()
    : getCloseTradingConfigurationError();
  if (tradingConfigError) {
    return fail("TRADING_DISABLED", tradingConfigError);
  }

  const scannedAt = pair.lastScannedAt?.getTime() ?? 0;
  const scanAgeMs = Date.now() - scannedAt;
  if (scanAgeMs < 0 || scanAgeMs > MAX_SIGNAL_AGE_MS) {
    return fail("SIGNAL_STALE", "Market signal is stale; wait for a fresh scanner update", { signalAgeMs: scanAgeMs });
  }
  if (
    pair.executionGuard !== "ADAPTIVE_GUARDS_CLEAR" ||
    !Number.isFinite(pair.currentPrice) ||
    pair.currentPrice <= 0
  ) {
    return fail(
      "GUARD_BLOCKED",
      pair.executionGuard || "Pair is blocked by the market safety checks",
      { signalAgeMs: scanAgeMs },
    );
  }

  const requiredState = opts.direction === "BUY" ? "BULL_EXEC" : "BEAR_EXEC";
  if (pair.state !== requiredState) {
    return fail("STATE_MISMATCH", `Fresh ${requiredState} signal required for ${opts.direction}`, { signalAgeMs: scanAgeMs });
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
    return fail(
      "MARKET_DATA_UNAVAILABLE",
      "Fresh market data or minimum $100,000 liquidity check failed",
      { signalAgeMs: scanAgeMs },
    );
  }
  const marketTokenMatches = chain === "solana"
    ? market.baseTokenAddress === expectedTokenAddress
    : market.baseTokenAddress.toLowerCase() === expectedTokenAddress.toLowerCase();
  if (!marketTokenMatches) {
    return fail("MARKET_DATA_UNAVAILABLE", "Live DEX base token does not match the watched token", { signalAgeMs: scanAgeMs });
  }
  const priceDriftPct = Math.abs(market.price - pair.currentPrice) / pair.currentPrice * 100;
  if (priceDriftPct > MAX_ENTRY_PRICE_DRIFT_PCT) {
    return fail("PRICE_DRIFT", "Market moved more than 2% since the last scan; trade blocked", { signalAgeMs: scanAgeMs });
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
      return fail("NO_POSITION_TO_CLOSE", "No open spot position to sell", { signalAgeMs: scanAgeMs });
    }
    const closed = await closePositionLocked(openPositions[0].id, 100);
    await recordOutcome(opts, closed.success ? "EXECUTED" : "EXECUTION_FAILED", {
      reason: closed.error ?? "Closed existing position",
      executed: closed.success,
      positionId: openPositions[0].id,
      pair: ctx,
      signalAgeMs: scanAgeMs,
    });
    return {
      success: closed.success,
      txHash: closed.txHash,
      error: closed.error,
    };
  }

  const { allowed, reason } = await canOpenPosition(chain, {
    requireAutoExecute: opts.signalId !== undefined,
  });
  if (!allowed) return fail("POSITION_LIMIT", reason ?? "Position limit reached", { signalAgeMs: scanAgeMs });

  const sizing = await calculatePositionSize(chain, {
    marketRegime: pair.marketRegime,
    confidenceScore: pair.confidenceScore,
    liquidityScore: pair.liquidityScore,
    suggestedStopLossPct: pair.adaptiveStopLossPct,
    executionAllowed: true,
    executionGuard: pair.executionGuard,
  });
  if (sizing.riskPct <= 0) {
    return fail("RISK_ZERO", pair.executionGuard ?? "Adaptive risk is zero", {
      signalAgeMs: scanAgeMs,
      intendedSizeUsd: sizing.positionSizeUsd,
    });
  }
  const positionSizeUsd = Math.min(sizing.positionSizeUsd, 1_000);
  const walletAddress = chain === "solana"
    ? await getSolanaWalletAddress()
    : await getWalletAddress(chain);

  if (!walletAddress) {
    return fail(
      "NO_WALLET",
      `No wallet configured for ${chain}. Set ${chain === "solana" ? "SOLANA_WALLET_PRIVATE_KEY" : "EVM_WALLET_PRIVATE_KEY"} in Secrets.`,
      { signalAgeMs: scanAgeMs, intendedSizeUsd: positionSizeUsd },
    );
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
      tokenAmountIn: positionSizeUsd,
      tokenAmountOut: 0,
      remainingTokenAmountRaw: null,
      remainingCostBasisUsd: positionSizeUsd,
      tokenDecimals: null,
      entryTxHash: null,
      capitalAtEntry: sizing.capitalAtEntry,
      riskPct: sizing.riskPct,
      obHigh: opts.obHigh,
      obLow: opts.obLow,
      stopLossPrice: market.price * (1 - stopLossPct / 100),
      stopLossPct,
      tpLevels: JSON.stringify(sizing.tpLevels),
      walletAddress,
      notes: `${opts.signalId === undefined ? "Manual" : "Auto"} execution: ${opts.ltfMessage} | Tier: ${sizing.scalingTier} | Regime: ${pair.marketRegime ?? "UNKNOWN"} | Confidence: ${pair.confidenceScore ?? 0}`,
    })
    .returning();

  // Persist an execution marker before broadcasting. If the process exits
  // after the swap but before reconciliation, this row blocks a blind retry.
  let txResult;
  if (chain === "solana") {
    txResult = await executeBuySolana(expectedTokenAddress, positionSizeUsd);
  } else {
    txResult = await executeBuyEVM(chain, expectedTokenAddress as Address, positionSizeUsd);
  }

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

  const outcomeVerdict: Verdict = reconciledSuccess
    ? "EXECUTED"
    : txResult.txHash
      ? "RECONCILIATION_REQUIRED"
      : "EXECUTION_FAILED";
  const outcomeReason = reconciledSuccess
    ? "Position opened successfully"
    : txResult.error ?? (txResult.txHash
      ? "Transaction was submitted but its result needs reconciliation; do not retry"
      : "Trade failed before confirmation");

  await recordOutcome(opts, outcomeVerdict, {
    reason: outcomeReason,
    executed: reconciledSuccess,
    positionId: position.id,
    intendedSizeUsd: positionSizeUsd,
    pair: ctx,
    signalAgeMs: scanAgeMs,
  });

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
    error: reconciledSuccess ? undefined : outcomeReason,
    positionSizeUsd,
  };
}

function numberToRawFloor(amount: number, decimals: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return null;
  }
  const [mantissa, exponentText] = amount.toString().toLowerCase().split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const shift = decimals + exponent - fraction.length;
  const rawDigits = shift >= 0
    ? `${digits}${"0".repeat(shift)}`
    : digits.slice(0, Math.max(0, digits.length + shift));
  try {
    const raw = BigInt(rawDigits || "0");
    return raw > 0n ? raw.toString() : null;
  } catch {
    return null;
  }
}

function rawToNumber(amountRaw: string, decimals: number): number {
  return Number(amountRaw) / (10 ** decimals);
}

export async function closePosition(
  positionId: number,
  pctToClose: number = 100
): Promise<{ success: boolean; pnlUsd?: number; txHash?: string; error?: string }> {
  const configError = getCloseTradingConfigurationError();
  if (configError) return { success: false, error: configError };
  if (!Number.isInteger(positionId) || positionId <= 0 || !Number.isFinite(pctToClose) || pctToClose < 1 || pctToClose > 100) {
    return { success: false, error: "Invalid position id or close percentage" };
  }

  const release = await acquireAdvisoryLock(TRADE_LOCK_NAMESPACE, 1);
  if (!release) {
    return { success: false, error: "Another trade is in progress; retry after it completes" };
  }
  try {
    return await closePositionLocked(positionId, pctToClose);
  } finally {
    await release();
  }
}

async function closePositionLocked(
  positionId: number,
  pctToClose: number,
): Promise<{ success: boolean; pnlUsd?: number; txHash?: string; error?: string }> {
  const position = await db
    .select()
    .from(positionsTable)
    .where(eq(positionsTable.id, positionId))
    .then((r) => r[0]);

  if (!position) return { success: false, error: "Position not found" };
  if (position.status !== "OPEN" && position.status !== "PARTIAL") {
    return {
      success: false,
      error: position.status === "CLOSED"
        ? "Position already closed"
        : `Position cannot be closed while it is ${position.status}`,
    };
  }

  const pair = await db
    .select()
    .from(watchedPairsTable)
    .where(eq(watchedPairsTable.id, position.pairId))
    .then((r) => r[0]);

  if (!pair?.baseTokenAddress || pair.chain !== position.chain) {
    return { success: false, error: "Position pair or chain could not be verified" };
  }
  const configuredWallet = position.chain === "solana"
    ? await getSolanaWalletAddress()
    : await getWalletAddress(position.chain);
  if (!configuredWallet) return { success: false, error: "No wallet is configured for this position's chain" };
  if (position.walletAddress && (position.chain === "solana"
    ? position.walletAddress !== configuredWallet
    : position.walletAddress.toLowerCase() !== configuredWallet.toLowerCase())) {
    return { success: false, error: "Position wallet does not match the configured signing wallet" };
  }

  const verifiedDecimals = position.chain === "solana"
    ? await getSolanaTokenDecimals(pair.baseTokenAddress)
    : await getEvmTokenDecimals(position.chain, pair.baseTokenAddress);
  if (verifiedDecimals === null || (position.tokenDecimals !== null && position.tokenDecimals !== verifiedDecimals)) {
    return { success: false, error: "Could not verify the position token decimals" };
  }
  if (position.status === "PARTIAL" && !position.remainingTokenAmountRaw) {
    return { success: false, error: "Legacy partial position requires reconciliation before another close" };
  }

  const remainingRaw = position.remainingTokenAmountRaw &&
    /^\d+$/.test(position.remainingTokenAmountRaw)
    ? BigInt(position.remainingTokenAmountRaw)
    : BigInt(numberToRawFloor(position.tokenAmountOut, verifiedDecimals) ?? "0");
  if (remainingRaw <= 0n) return { success: false, error: "Position has no verified sellable token amount" };

  const closeBps = BigInt(Math.round(pctToClose * 100));
  const amountRawToClose = closeBps === 10_000n
    ? remainingRaw
    : remainingRaw * closeBps / 10_000n;
  if (amountRawToClose <= 0n) {
    return { success: false, error: "Close percentage is smaller than one token's atomic unit" };
  }
  const amountToClose = rawToNumber(amountRawToClose.toString(), verifiedDecimals);
  if (!Number.isFinite(amountToClose) || amountToClose <= 0) {
    return { success: false, error: "Position sell amount is outside supported numeric range" };
  }

  const remainingCostBasis = position.remainingCostBasisUsd ??
    (position.status === "OPEN" ? position.entryAmountUsd : null);
  if (remainingCostBasis === null || !Number.isFinite(remainingCostBasis) || remainingCostBasis <= 0) {
    return { success: false, error: "Position cost basis needs reconciliation before closing" };
  }

  await db
    .update(positionsTable)
    .set({
      status: "CLOSING",
      remainingTokenAmountRaw: remainingRaw.toString(),
      tokenDecimals: verifiedDecimals,
      remainingCostBasisUsd: remainingCostBasis,
      lastUpdatedAt: new Date(),
    })
    .where(and(
      eq(positionsTable.id, positionId),
      inArray(positionsTable.status, ["OPEN", "PARTIAL"]),
    ));

  let txResult;
  if (position.chain === "solana") {
    txResult = await executeSellSolana(
      pair.baseTokenAddress,
      verifiedDecimals,
      amountToClose,
      amountRawToClose.toString(),
    );
  } else {
    txResult = await executeSellEVM(
      position.chain,
      pair.baseTokenAddress as Address,
      amountToClose,
      verifiedDecimals,
      0.5,
      amountRawToClose.toString(),
    );
  }

  const hasExactOutput = Boolean(txResult.amountOutRaw) &&
    /^\d+$/.test(txResult.amountOutRaw ?? "") &&
    BigInt(txResult.amountOutRaw ?? "0") > 0n;

  const proceedsUsd = hasExactOutput
    ? rawToNumber(txResult.amountOutRaw!, txResult.outputDecimals ?? 6)
    : null;
  const costBasisClosed = remainingCostBasis * (Number(amountRawToClose) / Number(remainingRaw));
  const realizedPnl = proceedsUsd !== null ? proceedsUsd - costBasisClosed : null;

  const isFullClose = pctToClose >= 100 || amountRawToClose >= remainingRaw;
  const remainingAfter = remainingRaw - amountRawToClose;

  await db
    .update(positionsTable)
    .set({
      status: txResult.success ? (isFullClose ? "CLOSED" : "PARTIAL") : "RECONCILIATION_REQUIRED",
      exitPrice: proceedsUsd !== null ? proceedsUsd / amountToClose : null,
      exitAmountUsd: proceedsUsd,
      exitTxHash: txResult.txHash ?? null,
      realizedPnlUsd: realizedPnl,
      realizedPnlPct: realizedPnl !== null && costBasisClosed > 0
        ? (realizedPnl / costBasisClosed) * 100
        : null,
      remainingTokenAmountRaw: txResult.success
        ? (isFullClose ? "0" : remainingAfter.toString())
        : remainingRaw.toString(),
      remainingCostBasisUsd: txResult.success
        ? (isFullClose ? 0 : remainingCostBasis - costBasisClosed)
        : remainingCostBasis,
      closedAt: txResult.success && isFullClose ? new Date() : null,
      lastUpdatedAt: new Date(),
    })
    .where(eq(positionsTable.id, positionId));

  if (txResult.success && realizedPnl !== null) {
    await recordTradeResult(position.chain, realizedPnl, realizedPnl > 0);
  }

  return {
    success: txResult.success,
    pnlUsd: realizedPnl ?? undefined,
    txHash: txResult.txHash,
    error: txResult.error,
  };
}
