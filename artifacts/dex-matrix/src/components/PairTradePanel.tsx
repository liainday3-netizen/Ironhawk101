import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCapitalQueryKey,
  getGetPerformanceQueryKey,
  getListPositionsQueryKey,
  getGetTradingStatusQueryKey,
  useClosePosition,
  useExecuteSignal,
  useGetTradingStatus,
  useListPositions,
  type Position,
  type WatchedPair,
} from "@workspace/api-client-react";

const MAX_ORDER_USD = 1_000;

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);
}

function getExplorerUrl(chain: string, txHash: string): string | null {
  if (chain === "solana") return `https://solscan.io/tx/${encodeURIComponent(txHash)}`;
  if (chain === "base") return `https://basescan.org/tx/${encodeURIComponent(txHash)}`;
  if (chain === "ethereum") return `https://etherscan.io/tx/${encodeURIComponent(txHash)}`;
  return null;
}

export function PairTradePanel({ pair }: { pair: WatchedPair }) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const execute = useExecuteSignal();
  const close = useClosePosition();
  const tradingStatusQuery = useGetTradingStatus({
    query: {
      queryKey: getGetTradingStatusQueryKey(),
      refetchInterval: 30_000,
      retry: false,
    },
  });
  const positionParams = useMemo(
    () => ({ pairId: pair.id, chain: pair.chain, status: "all" }),
    [pair.id, pair.chain],
  );
  const positionsQuery = useListPositions<Position[]>(positionParams, {
    query: {
      queryKey: getListPositionsQueryKey(positionParams),
      enabled: pair.id > 0,
      refetchInterval: 15_000,
      retry: false,
    },
  });

  const tradingStatus = tradingStatusQuery.data;
  const positions = (positionsQuery.data ?? []).filter((position) => position.pairId === pair.id);
  const activePositions = positions.filter((position) =>
    position.status === "OPEN" || position.status === "PARTIAL",
  );
  const scanTime = pair.lastScannedAt ? new Date(pair.lastScannedAt).getTime() : 0;
  const scanAgeMs = Date.now() - scanTime;
  const signalIsFresh = scanTime > 0 && scanAgeMs >= 0 && scanAgeMs <= 90_000;
  const buyBlockReason = !pair.baseTokenAddress
    ? "The watched pair has no verified token address."
    : !signalIsFresh
      ? "Waiting for a fresh scanner update."
      : pair.executionGuard !== "ADAPTIVE_GUARDS_CLEAR"
        ? pair.executionGuard || "Market safety checks are blocking execution."
        : pair.state !== "BULL_EXEC"
          ? "A fresh BULL_EXEC signal is required to buy."
          : !tradingStatus?.newTradesEnabled
            ? tradingStatus?.newTradeReason || "New trades are disabled."
            : null;
  const closeBlockReason = !tradingStatus?.closesEnabled
    ? tradingStatus?.closeReason || "On-chain closes are disabled."
    : null;
  const tradingAccessError = tradingStatusQuery.isError || positionsQuery.isError;

  async function refreshTradingData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListPositionsQueryKey(positionParams) }),
      queryClient.invalidateQueries({ queryKey: getGetPerformanceQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetCapitalQueryKey() }),
    ]);
  }

  async function executeBuy() {
    const prompt =
      `This will submit a live BUY on ${pair.chain.toUpperCase()} for ${pair.symbol}. ` +
      `The server wallet signs it; order size comes from the saved capital/risk settings ` +
      `and is capped at ${formatUsd(MAX_ORDER_USD)}. Continue?`;
    if (!window.confirm(prompt)) return;

    setFeedback(null);
    setLastTx(null);
    try {
      const result = await execute.mutateAsync({
        data: {
          pairId: pair.id,
          direction: "BUY",
          tokenAddress: pair.baseTokenAddress,
        },
      });
      if (!result.success) {
        setFeedback(result.error || "The order was not confirmed. Check position status before retrying.");
      } else {
        setFeedback(`BUY confirmed at ${formatUsd(result.positionSizeUsd)} configured order size.`);
      }
      setLastTx(result.txHash ?? null);
      await refreshTradingData();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Buy request failed.");
      await refreshTradingData();
    }
  }

  async function closePosition(positionId: number, pctToClose: number, symbol: string) {
    const scope = pctToClose === 100
      ? "the entire remaining position"
      : `${pctToClose}% of the remaining position`;
    if (!window.confirm(`Submit a live sell of ${scope} for ${symbol} on ${pair.chain.toUpperCase()}?`)) {
      return;
    }

    setFeedback(null);
    setLastTx(null);
    try {
      const result = await close.mutateAsync({
        id: positionId,
        data: { pctToClose },
      });
      if (!result.success) {
        setFeedback(result.error || "The close was not confirmed. Check position status before retrying.");
      } else {
        setFeedback(`Close confirmed. Realized P&L for this exit: ${formatUsd(result.pnlUsd)}.`);
      }
      setLastTx(result.txHash ?? null);
      await refreshTradingData();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Close request failed.");
      await refreshTradingData();
    }
  }

  return (
    <section className="border border-border bg-card" aria-labelledby="pair-trading-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 id="pair-trading-title" className="font-mono text-sm font-bold text-foreground">
            MANUAL_EXECUTION
          </h2>
          <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-muted-foreground">
            Orders use the server wallet and saved capital/risk settings. There is no wallet
            approval pop-up; each action below asks for confirmation before submitting.
          </p>
        </div>
        <span
          className={`border px-2 py-1 font-mono text-[10px] font-bold ${
            tradingStatus?.newTradesEnabled
              ? "border-green-500/40 bg-green-500/10 text-green-500"
              : "border-amber-500/40 bg-amber-500/10 text-amber-500"
          }`}
        >
          {tradingStatus?.newTradesEnabled ? "NEW_ORDERS_ARMED" : "NEW_ORDERS_BLOCKED"}
        </span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <div className="border border-destructive/30 bg-destructive/5 p-3">
            <p className="font-mono text-[11px] font-bold text-destructive">
              REAL FUNDS · MAINNET TRANSACTION
            </p>
            <p className="mt-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
              BUY uses the active chain’s configured size and risk limits, with a hard $1,000
              per-position cap. Network fees and swap slippage still apply.
            </p>
          </div>

          {tradingAccessError && (
            <p role="alert" className="border border-destructive/30 p-3 font-mono text-xs text-destructive">
              Trading status or positions could not be loaded. This account may not be on the
              trading owner allowlist.
            </p>
          )}

          <button
            type="button"
            onClick={executeBuy}
            disabled={Boolean(buyBlockReason) || execute.isPending || close.isPending || tradingStatusQuery.isLoading}
            className="w-full border border-green-500/50 bg-green-500/10 px-4 py-3 text-left font-mono text-xs font-bold text-green-500 transition-colors hover:bg-green-500/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-secondary disabled:text-muted-foreground"
            aria-describedby="pair-buy-reason"
          >
            <span className="block">{execute.isPending ? "SUBMITTING_BUY…" : "BUY · SERVER-SIZED ORDER"}</span>
            <span className="mt-1 block text-[10px] font-normal">
              {pair.chain.toUpperCase()} · maximum {formatUsd(MAX_ORDER_USD)}
            </span>
          </button>
          <p id="pair-buy-reason" className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            {tradingStatusQuery.isLoading
              ? "Checking trading gates…"
              : buyBlockReason
                ? `BUY blocked: ${buyBlockReason}`
                : "BUY available for the current fresh signal."}
          </p>
          {closeBlockReason && (
            <p className="font-mono text-[10px] leading-relaxed text-amber-500">
              CLOSE blocked: {closeBlockReason}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-mono text-xs font-bold text-foreground">POSITIONS_FOR_THIS_PAIR</h3>
            <span className="font-mono text-[10px] text-muted-foreground">
              {positionsQuery.isLoading ? "LOADING…" : `${activePositions.length} OPEN`}
            </span>
          </div>

          {positionsQuery.isError ? (
            <div role="alert" className="border border-border p-3 font-mono text-xs text-muted-foreground">
              Position list unavailable. No close controls are shown until access and status can be verified.
            </div>
          ) : positions.length === 0 && !positionsQuery.isLoading ? (
            <div className="border border-dashed border-border p-4 font-mono text-xs text-muted-foreground">
              No positions are recorded for this pair.
            </div>
          ) : (
            <div className="space-y-2">
              {positions.map((position) => {
                const canClose =
                  (position.status === "OPEN" || position.status === "PARTIAL") &&
                  Boolean(tradingStatus?.closesEnabled) &&
                  !(position.status === "PARTIAL" && !position.remainingTokenAmountRaw);
                const amount = position.status === "OPEN" || position.status === "PARTIAL"
                  ? position.tokenAmountOut
                  : null;
                const explorerUrl = position.exitTxHash
                  ? getExplorerUrl(position.chain, position.exitTxHash)
                  : position.entryTxHash
                    ? getExplorerUrl(position.chain, position.entryTxHash)
                    : null;

                return (
                  <article key={position.id} className="border border-border bg-background p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs font-bold text-foreground">
                          #{position.id} · {position.symbol} · {position.chain.toUpperCase()}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {position.status} · remaining {formatAmount(amount)} · cost basis{" "}
                          {formatUsd(position.remainingCostBasisUsd)}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        entry {formatUsd(position.entryAmountUsd)}
                      </span>
                    </div>

                    {position.status === "RECONCILIATION_REQUIRED" && (
                      <p className="mt-2 border border-amber-500/30 bg-amber-500/5 p-2 font-mono text-[10px] text-amber-500">
                        Transaction result needs reconciliation. Do not retry this position automatically.
                      </p>
                    )}
                    {position.status === "PARTIAL" && !position.remainingTokenAmountRaw && (
                      <p className="mt-2 font-mono text-[10px] text-amber-500">
                        Exact remaining token amount is missing; reconcile this legacy partial position before selling again.
                      </p>
                    )}

                    {canClose ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[25, 50, 100].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            disabled={close.isPending || execute.isPending || !tradingStatus?.closesEnabled}
                            onClick={() => closePosition(position.id, pct, position.symbol)}
                            className="border border-red-500/40 px-3 py-2 font-mono text-[10px] font-bold text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:border-border disabled:text-muted-foreground"
                          >
                            {close.isPending ? "SUBMITTING…" : `SELL ${pct}%`}
                          </button>
                        ))}
                      </div>
                    ) : position.status === "OPEN" || position.status === "PARTIAL" ? (
                      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                        {closeBlockReason || "Close blocked pending exact amount reconciliation."}
                      </p>
                    ) : (
                      <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                        No close action for status {position.status}.
                      </p>
                    )}

                    {explorerUrl && (
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block font-mono text-[10px] text-primary underline"
                      >
                        View last transaction
                      </a>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {(feedback || lastTx) && (
        <div aria-live="polite" className="border-t border-border p-4 font-mono text-xs">
          {feedback && <p className="text-foreground">{feedback}</p>}
          {lastTx && <p className="mt-1 break-all text-muted-foreground">TX: {lastTx}</p>}
        </div>
      )}
    </section>
  );
}