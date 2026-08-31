/**
 * IronHawk Scanner Service
 * Periodically fetches market data and runs microstructure analysis on all watched pairs.
 * When autoExecute is enabled for a chain, fires on-chain swaps directly from here.
 */

import { db, watchedPairsTable, signalsTable, capitalConfigTable } from "@workspace/db";
import { monitorPositions, executeSignal } from "./tradeExecutor";
import { calculatePositionSize } from "./capitalScaling";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "./logger";
import { getOHLCV, getPairInfo } from "./marketData";
import { analyzeAsset } from "./microstructure";

const SCAN_INTERVAL_MS = 30_000;
let scanTimer: NodeJS.Timeout | null = null;
let isScanning = false;

export async function runScanCycle(): Promise<void> {
  if (isScanning) return;
  isScanning = true;

  try {
    const pairs = await db
      .select()
      .from(watchedPairsTable)
      .where(eq(watchedPairsTable.active, true));

    for (const pair of pairs) {
      try {
        const [htf4h, ltf15m, d1, info] = await Promise.all([
          getOHLCV(pair.pairAddress, pair.chain, "4h"),
          getOHLCV(pair.pairAddress, pair.chain, "15m"),
          getOHLCV(pair.pairAddress, pair.chain, "1d"),
          getPairInfo(pair.pairAddress, pair.chain),
        ]);

        const currentPrice = info?.price ?? pair.currentPrice;
        const prevState = pair.state;
        const result = analyzeAsset(htf4h, ltf15m, d1, currentPrice, {
          liquidityUsd: info?.liquidity ?? 0,
          volume24h: info?.volume24h ?? pair.volume24h,
        });
        const adaptiveSizing = await calculatePositionSize(pair.chain, {
          marketRegime: result.marketRegime,
          confidenceScore: result.confidenceScore,
          liquidityScore: result.liquidityScore,
          suggestedStopLossPct: result.suggestedStopLossPct,
          executionAllowed: result.executionAllowed,
          executionGuard: result.executionGuard,
        });

        // Update pair state + market data; also persist baseTokenAddress if we got it
        await db
          .update(watchedPairsTable)
          .set({
            state: result.state,
            htfMessage: result.htfMessage,
            ltfMessage: result.ltfMessage,
            signalAction: result.signalAction,
            marketRegime: result.marketRegime,
            confidenceScore: result.confidenceScore,
            atrPct: result.atrPct,
            volatilityRatio: result.volatilityRatio,
            liquidityScore: result.liquidityScore,
            adaptiveRiskPct: adaptiveSizing.riskPct,
            adaptiveStopLossPct: result.suggestedStopLossPct,
            executionGuard: result.executionGuard,
            obType: result.obType,
            obHigh: result.obHigh,
            obLow: result.obLow,
            currentPrice,
            priceChange24h: info?.priceChange24h ?? pair.priceChange24h,
            volume24h: info?.volume24h ?? pair.volume24h,
            dex: info?.dex || pair.dex,
            symbol: info?.symbol || pair.symbol,
            baseToken: info?.baseToken || pair.baseToken,
            // Only overwrite baseTokenAddress if we got a real one
            ...(info?.baseTokenAddress ? { baseTokenAddress: info.baseTokenAddress } : {}),
            quoteToken: info?.quoteToken || pair.quoteToken,
            lastScannedAt: new Date(),
          })
          .where(eq(watchedPairsTable.id, pair.id));

        const isNewSignal =
          (result.state === "BULL_EXEC" || result.state === "BEAR_EXEC") &&
          prevState !== result.state;

        if (isNewSignal && result.obHigh !== null && result.obLow !== null) {
          const direction = result.state === "BULL_EXEC" ? "BUY" : "SELL";

          const [insertedSignal] = await db
            .insert(signalsTable)
            .values({
              pairId: pair.id,
              symbol: info?.symbol || pair.symbol,
              chain: pair.chain,
              dex: info?.dex || pair.dex,
              direction,
              price: currentPrice,
              obHigh: result.obHigh,
              obLow: result.obLow,
              ltfMessage: result.ltfMessage,
              marketRegime: result.marketRegime,
              confidenceScore: result.confidenceScore,
              atrPct: result.atrPct,
              liquidityScore: result.liquidityScore,
              adaptiveRiskPct: adaptiveSizing.riskPct,
              executionGuard: result.executionGuard,
            })
            .returning();

          logger.info({ symbol: pair.symbol, direction, price: currentPrice }, "Signal fired");

          // --- Auto-execute: check if this chain has autoExecute enabled ---
          await maybeAutoExecute({
            pair: { ...pair, baseTokenAddress: info?.baseTokenAddress || pair.baseTokenAddress },
            direction,
            obHigh: result.obHigh,
            obLow: result.obLow,
            ltfMessage: result.ltfMessage,
            signalId: insertedSignal.id,
            isBull: result.state === "BULL_EXEC",
            executionAllowed: result.executionAllowed,
            executionGuard: result.executionGuard,
            marketRegime: result.marketRegime,
            confidenceScore: result.confidenceScore,
            liquidityScore: result.liquidityScore,
            suggestedStopLossPct: result.suggestedStopLossPct,
          });
        }
      } catch (err) {
        logger.error({ err, pairId: pair.id, symbol: pair.symbol }, "Error scanning pair");
        await db
          .update(watchedPairsTable)
          .set({ state: "SYNC_ERROR", htfMessage: "DATA SYNC ERROR", signalAction: "AWAITING TICKS" })
          .where(eq(watchedPairsTable.id, pair.id));
      }
    }

    try {
      await monitorPositions();
    } catch (err) {
      logger.error({ err }, "Position monitor error");
    }
  } catch (err) {
    logger.error({ err }, "Scanner cycle error");
  } finally {
    isScanning = false;
  }
}

interface AutoExecuteOpts {
  pair: { id: number; chain: string; baseTokenAddress: string };
  direction: "BUY" | "SELL";
  isBull: boolean;
  obHigh: number;
  obLow: number;
  ltfMessage: string;
  signalId: number;
  executionAllowed: boolean;
  executionGuard: string;
  marketRegime: string;
  confidenceScore: number;
  liquidityScore: number;
  suggestedStopLossPct: number;
}

async function maybeAutoExecute(opts: AutoExecuteOpts): Promise<void> {
  const { pair, direction, isBull, obHigh, obLow, ltfMessage, signalId } = opts;

  // Need a token address to execute — can't swap without it
  if (!pair.baseTokenAddress) {
    logger.warn({ pairId: pair.id, chain: pair.chain }, "Auto-execute skipped: no baseTokenAddress stored for this pair");
    return;
  }

  if (!opts.executionAllowed) {
    logger.info(
      { pairId: pair.id, chain: pair.chain, direction, guard: opts.executionGuard, regime: opts.marketRegime },
      "Auto-execute blocked by adaptive guard",
    );
    return;
  }

  let config;
  try {
    [config] = await db
      .select()
      .from(capitalConfigTable)
      .where(eq(capitalConfigTable.chain, pair.chain));
  } catch (err) {
    logger.error({ err }, "Failed to fetch capital config for auto-execute");
    return;
  }

  if (!config?.autoExecute) return;

  // Respect directional filters
  if (isBull && !config.onlyBullExec) return;
  if (!isBull && !config.onlyBearExec) return;

  logger.info(
    { pairId: pair.id, chain: pair.chain, direction, tokenAddress: pair.baseTokenAddress },
    "Auto-execute triggered"
  );

  // Fire and forget — don't block the scan cycle
  executeSignal({
    pairId: pair.id,
    direction,
    tokenAddress: pair.baseTokenAddress,
    obHigh,
    obLow,
    ltfMessage,
    signalId,
    marketRegime: opts.marketRegime,
    confidenceScore: opts.confidenceScore,
    liquidityScore: opts.liquidityScore,
    suggestedStopLossPct: opts.suggestedStopLossPct,
    executionGuard: opts.executionGuard,
  }).then((res) => {
    if (res.success) {
      logger.info({ positionId: res.positionId, txHash: res.txHash, sizeUsd: res.positionSizeUsd }, "Auto-execute: position opened");
    } else {
      logger.warn({ error: res.error }, "Auto-execute: execution failed");
    }
  }).catch((err) => {
    logger.error({ err }, "Auto-execute: unhandled error");
  });
}

export function startScanner(): void {
  if (scanTimer) return;
  logger.info("IronHawk scanner started");
  setTimeout(() => runScanCycle(), 2000);
  scanTimer = setInterval(() => runScanCycle(), SCAN_INTERVAL_MS);
}

export function stopScanner(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

export async function getScannerStats() {
  const pairs = await db.select().from(watchedPairsTable).where(eq(watchedPairsTable.active, true));

  const chainBreakdown: Record<string, number> = {};
  let activeBull = 0;
  let activeBear = 0;
  let inPoi = 0;
  let waiting = 0;
  let filteredBias = 0;
  let outOfSession = 0;
  let adaptiveBlocked = 0;
  let volatileMarkets = 0;
  let confidenceSum = 0;

  for (const p of pairs) {
    chainBreakdown[p.chain] = (chainBreakdown[p.chain] ?? 0) + 1;
    if (p.state === "BULL_EXEC") activeBull++;
    else if (p.state === "BEAR_EXEC") activeBear++;
    else if (p.state === "IN_HTF_POI") inPoi++;
    else if (p.state === "WAITING") waiting++;
    else if (p.state === "FILTERED_BIAS") filteredBias++;
    else if (p.state === "OUT_OF_SESSION") outOfSession++;
    if (p.executionGuard !== "ADAPTIVE_GUARDS_CLEAR" && p.executionGuard !== "INITIALIZING") adaptiveBlocked++;
    if (p.marketRegime === "VOLATILE" || p.marketRegime === "EXTREME") volatileMarkets++;
    confidenceSum += p.confidenceScore;
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [signalsTodayRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(signalsTable)
    .where(sql`${signalsTable.triggeredAt} >= ${today}`);

  const [signalsTotalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(signalsTable);

  return {
    totalPairs: pairs.length,
    activeBull,
    activeBear,
    inPoi,
    waiting,
    filteredBias,
    outOfSession,
    adaptiveBlocked,
    volatileMarkets,
    averageConfidence: pairs.length ? confidenceSum / pairs.length : 0,
    signalsToday: signalsTodayRow?.count ?? 0,
    signalsTotal: signalsTotalRow?.count ?? 0,
    chainBreakdown,
  };
}
