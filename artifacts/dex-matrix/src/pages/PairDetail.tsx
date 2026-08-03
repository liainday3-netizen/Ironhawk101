import { useRoute, useLocation } from "wouter";
import { useGetCandles, getGetCandlesQueryKey, useListPairs, getListPairsQueryKey, useRemovePair } from "@workspace/api-client-react";
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area } from "recharts";
import { format } from "date-fns";
import { ArrowLeft, Trash2, Activity, Target, TrendingUp, TrendingDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const STATE_BADGE: Record<string, string> = {
  BULL_EXEC: "text-green-500 bg-green-500/10 border-green-500/30",
  BEAR_EXEC: "text-red-500 bg-red-500/10 border-red-500/30",
  IN_HTF_POI: "text-primary bg-primary/10 border-primary/30",
  WAITING: "text-muted-foreground bg-secondary border-border",
  OUT_OF_SESSION: "text-slate-400 bg-slate-400/10 border-slate-400/20",
  FILTERED_BIAS: "text-gray-400 bg-gray-400/10 border-gray-400/20",
  SYNC_ERROR: "text-red-400 bg-red-400/5 border-red-400/20",
};

export default function PairDetail() {
  const [, params] = useRoute("/pair/:id");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const pairAddress = params?.id;
  const searchParams = new URLSearchParams(window.location.search);
  const chain = searchParams.get("chain") || "ethereum";

  const [timeframe, setTimeframe] = useState<"1m" | "5m" | "15m" | "1h" | "4h" | "1d">("15m");

  const { data: pairs = [] } = useListPairs({ query: { queryKey: getListPairsQueryKey() } });
  const pair = pairs.find(p => p.pairAddress === pairAddress && p.chain === chain);

  const { data: candles = [], isLoading } = useGetCandles(
    { pairAddress: pairAddress!, chain: chain as any, timeframe },
    { query: { enabled: !!pairAddress, queryKey: getGetCandlesQueryKey({ pairAddress: pairAddress!, chain: chain as any, timeframe }) } }
  );

  const removePair = useRemovePair();

  const handleRemove = () => {
    if (pair?.id) {
      removePair.mutate({ id: pair.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPairsQueryKey() });
          setLocation("/");
        }
      });
    }
  };

  if (!pairAddress) return null;

  const chartData = candles.map(c => ({
    ...c,
    timeLabel: format(new Date(c.time * 1000), timeframe === "1d" ? "MMM dd" : "HH:mm"),
    price: c.close,
    isUp: c.close >= c.open,
    vol: c.volume
  }));

  const stateBadge = STATE_BADGE[pair?.state ?? "WAITING"] || STATE_BADGE.WAITING;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex-none p-4 md:p-6 border-b border-border bg-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => setLocation("/")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold font-mono text-foreground tracking-tight flex items-center gap-2 flex-wrap">
              {pair?.symbol || "UNKNOWN_PAIR"}
              <span className="text-xs px-2 py-0.5 border border-border text-muted-foreground bg-background">
                {chain.toUpperCase()}
              </span>
              {pair && (
                <span className={`text-xs px-2 py-0.5 border font-bold ${stateBadge}`}>
                  {pair.state}
                </span>
              )}
            </h1>
            <p className="text-xs font-mono text-muted-foreground mt-1 truncate max-w-md">
              {pairAddress}
            </p>
          </div>
        </div>

        {pair && (
          <div className="flex items-center gap-4">
            <div className="flex flex-col text-right font-mono">
              <span className="text-lg text-foreground font-bold">
                ${pair.currentPrice < 0.001 ? pair.currentPrice.toFixed(8) : pair.currentPrice.toFixed(4)}
              </span>
              <span className={`text-xs ${pair.priceChange24h >= 0 ? "text-green-500" : "text-red-500"}`}>
                {pair.priceChange24h > 0 ? "+" : ""}{pair.priceChange24h.toFixed(2)}%
              </span>
            </div>
            <button
              onClick={handleRemove}
              disabled={removePair.isPending}
              className="p-2 border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
              title="REMOVE_FROM_WATCHLIST"
            >
              <Trash2 size={18} />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 p-4 md:p-6 flex flex-col gap-6">
        {/* Microstructure State Panel */}
        {pair && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="border border-border bg-card p-4 flex flex-col gap-2">
              <span className="font-mono text-xs text-muted-foreground">MARKET_STATE</span>
              <div className={`font-mono text-sm font-bold flex items-center gap-2 ${pair.state === "BULL_EXEC" ? "text-green-500" : pair.state === "BEAR_EXEC" ? "text-red-500" : "text-primary"}`}>
                <Activity size={14} />
                {pair.state}
              </div>
            </div>
            <div className="border border-border bg-card p-4 flex flex-col gap-2">
              <span className="font-mono text-xs text-muted-foreground">HTF_LOGIC</span>
              <div className="font-mono text-xs text-foreground">{pair.htfMessage || "NO_DATA"}</div>
            </div>
            <div className="border border-border bg-card p-4 flex flex-col gap-2">
              <span className="font-mono text-xs text-muted-foreground">LTF_FRACTAL</span>
              <div className="font-mono text-xs text-foreground">{pair.ltfMessage || "---"}</div>
            </div>
            <div className="border border-border bg-card p-4 flex flex-col gap-2">
              <span className="font-mono text-xs text-muted-foreground">SIGNAL_ACTION</span>
              <div className={`font-mono text-xs font-bold ${pair.signalAction?.includes("BUY") ? "text-green-500" : pair.signalAction?.includes("SELL") ? "text-red-500" : "text-muted-foreground"}`}>
                {pair.signalAction || "SEARCHING"}
              </div>
            </div>
          </div>
        )}

        {/* OB Levels */}
        {pair && pair.obHigh !== null && pair.obLow !== null && (
          <div className="flex gap-4">
            <div className="flex items-center gap-2 px-3 py-2 border border-green-500/30 bg-green-500/5 font-mono text-xs">
              <TrendingUp size={12} className="text-green-500" />
              <span className="text-muted-foreground">OB_HIGH:</span>
              <span className="text-green-500 font-bold">${pair.obHigh?.toFixed(4)}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border border-red-500/30 bg-red-500/5 font-mono text-xs">
              <TrendingDown size={12} className="text-red-500" />
              <span className="text-muted-foreground">OB_LOW:</span>
              <span className="text-red-500 font-bold">${pair.obLow?.toFixed(4)}</span>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="flex-1 border border-border bg-card flex flex-col min-h-[400px]">
          <div className="flex p-2 border-b border-border bg-secondary/50 gap-1 overflow-x-auto items-center">
            <span className="font-mono text-xs text-muted-foreground px-2 flex items-center gap-1">
              <Target size={12} />
              OHLCV
            </span>
            {(["1m", "5m", "15m", "1h", "4h", "1d"] as const).map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1 font-mono text-xs font-bold transition-colors ${timeframe === tf ? "bg-accent text-primary border border-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex-1 p-4">
            {isLoading ? (
              <div className="h-full w-full flex items-center justify-center font-mono text-muted-foreground animate-pulse">
                INITIALIZING_CHART_DATA...
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-full w-full flex items-center justify-center font-mono text-muted-foreground">
                NO_CANDLE_DATA_AVAILABLE.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={320}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="timeLabel"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                    stroke="hsl(var(--border))"
                    minTickGap={30}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
                    stroke="hsl(var(--border))"
                    orientation="right"
                    tickFormatter={(val) => val > 1 ? val.toFixed(2) : val.toFixed(6)}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 0, fontFamily: 'monospace', fontSize: 12 }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                    labelStyle={{ color: 'hsl(var(--primary))', marginBottom: 4 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke="hsl(var(--primary))"
                    fill="hsl(var(--primary) / 0.08)"
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="vol"
                    fill="hsl(var(--muted-foreground) / 0.15)"
                    yAxisId={0}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
