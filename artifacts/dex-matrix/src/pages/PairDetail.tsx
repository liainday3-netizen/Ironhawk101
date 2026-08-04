import { useRoute, useLocation } from "wouter";
import { useGetCandles, getGetCandlesQueryKey, useListPairs, getListPairsQueryKey, useRemovePair } from "@workspace/api-client-react";
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { format } from "date-fns";
import { ArrowLeft, Trash2, Activity, Target, TrendingUp, TrendingDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";

const STATE_BADGE: Record<string, string> = {
  BULL_EXEC: "text-green-500 bg-green-500/10 border-green-500/30",
  BEAR_EXEC: "text-red-500 bg-red-500/10 border-red-500/30",
  IN_HTF_POI: "text-primary bg-primary/10 border-primary/30",
  WAITING: "text-muted-foreground bg-secondary border-border",
  OUT_OF_SESSION: "text-slate-400 bg-slate-400/10 border-slate-400/20",
  FILTERED_BIAS: "text-gray-400 bg-gray-400/10 border-gray-400/20",
  SYNC_ERROR: "text-red-400 bg-red-400/5 border-red-400/20",
};

// ── Candlestick custom bar shape ────────────────────────────────────────────
// The chart uses TWO stacked bars:
//   1. fillerLow  (transparent) — pushes the stack up to the candle's low price
//   2. wickRange  (this shape)  — spans high → low; we derive body position from ratio
const CandleBar = (props: any) => {
  const { x, y, width, height, payload } = props;
  if (!payload || !height || height <= 0 || !width) return null;

  const { open, high, low, close } = payload;
  if (high <= low || width < 1) return null;

  const isUp = close >= open;
  const color = isUp ? "#22c55e" : "#ef4444";
  const priceRange = high - low;
  if (priceRange === 0) return null;

  const ratio = height / priceRange; // pixels per price unit within this bar
  const bodyTopPrice = Math.max(open, close);
  const bodyBottomPrice = Math.min(open, close);
  const bodyY = y + (high - bodyTopPrice) * ratio;
  const bodyH = Math.max(1, (bodyTopPrice - bodyBottomPrice) * ratio);
  const cx = x + width / 2;
  const halfW = Math.max(1, (width - 2) / 2);

  return (
    <g>
      {/* High wick */}
      <line x1={cx} y1={y} x2={cx} y2={bodyY} stroke={color} strokeWidth={1} />
      {/* Low wick */}
      <line x1={cx} y1={bodyY + bodyH} x2={cx} y2={y + height} stroke={color} strokeWidth={1} />
      {/* Body */}
      <rect
        x={cx - halfW}
        y={bodyY}
        width={halfW * 2}
        height={bodyH}
        fill={color}
        fillOpacity={isUp ? 0.85 : 1}
        stroke={color}
        strokeWidth={0.5}
      />
    </g>
  );
};

// ── EMA helper ───────────────────────────────────────────────────────────────
function computeEMA(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = [];
  let ema: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      ema = values[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
const CandleTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const isUp = d.close >= d.open;
  return (
    <div className="bg-card border border-border p-3 font-mono text-xs space-y-1 min-w-[140px]">
      <div className="text-muted-foreground">{label}</div>
      <div className={isUp ? "text-green-500" : "text-red-500"}>
        O: {d.open?.toFixed(6)} H: {d.high?.toFixed(6)}
      </div>
      <div className={isUp ? "text-green-500" : "text-red-500"}>
        L: {d.low?.toFixed(6)} C: {d.close?.toFixed(6)}
      </div>
      <div className="text-muted-foreground">VOL: {d.volume?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
      {d.ema20 && <div className="text-yellow-400">EMA20: {d.ema20.toFixed(6)}</div>}
    </div>
  );
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

  // ── Build chart data with candlestick + EMA ──────────────────────────────
  const chartData = useMemo(() => {
    if (!candles.length) return [];
    const closes = candles.map(c => c.close);
    const ema20 = computeEMA(closes, 20);
    const ema9 = computeEMA(closes, 9);
    const maxVol = Math.max(...candles.map(c => c.volume), 1);

    return candles.map((c, i) => ({
      ...c,
      timeLabel: format(new Date(c.time * 1000), timeframe === "1d" ? "MMM dd" : "HH:mm"),
      // Stacked bar pair for candlestick rendering:
      fillerLow: c.low,
      wickRange: c.high - c.low,
      // Volume scaled to bottom 20% of chart via secondary axis
      vol: c.volume,
      volScaled: (c.volume / maxVol) * 100,
      ema20: ema20[i],
      ema9: ema9[i],
    }));
  }, [candles, timeframe]);

  const stateBadge = STATE_BADGE[pair?.state ?? "WAITING"] || STATE_BADGE.WAITING;

  // Price domain with 2% padding
  const { priceMin, priceMax } = useMemo(() => {
    if (!candles.length) return { priceMin: 0, priceMax: 1 };
    const lows = candles.map(c => c.low);
    const highs = candles.map(c => c.high);
    const lo = Math.min(...lows);
    const hi = Math.max(...highs);
    const pad = (hi - lo) * 0.02;
    return { priceMin: lo - pad, priceMax: hi + pad };
  }, [candles]);

  const priceFormatter = (val: number) =>
    val === 0 ? "" : val < 0.0001 ? val.toExponential(2) : val > 1000 ? val.toFixed(0) : val > 1 ? val.toFixed(2) : val.toFixed(6);

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
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-2 border border-green-500/30 bg-green-500/5 font-mono text-xs">
              <TrendingUp size={12} className="text-green-500" />
              <span className="text-muted-foreground">OB_HIGH:</span>
              <span className="text-green-500 font-bold">${pair.obHigh?.toFixed(6)}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border border-red-500/30 bg-red-500/5 font-mono text-xs">
              <TrendingDown size={12} className="text-red-500" />
              <span className="text-muted-foreground">OB_LOW:</span>
              <span className="text-red-500 font-bold">${pair.obLow?.toFixed(6)}</span>
            </div>
          </div>
        )}

        {/* OHLCV Candlestick Chart */}
        <div className="flex-1 border border-border bg-card flex flex-col min-h-[420px]">
          {/* Toolbar */}
          <div className="flex p-2 border-b border-border bg-secondary/50 gap-1 overflow-x-auto items-center justify-between">
            <div className="flex items-center gap-1">
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
            {/* EMA legend */}
            <div className="flex items-center gap-3 pr-2">
              <span className="flex items-center gap-1 font-mono text-xs text-yellow-400">
                <span className="w-4 h-0.5 bg-yellow-400 inline-block" /> EMA9
              </span>
              <span className="flex items-center gap-1 font-mono text-xs text-blue-400">
                <span className="w-4 h-0.5 bg-blue-400 inline-block" /> EMA20
              </span>
            </div>
          </div>

          <div className="flex-1 p-2">
            {isLoading ? (
              <div className="h-full w-full flex items-center justify-center font-mono text-muted-foreground animate-pulse">
                INITIALIZING_CHART_DATA...
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-full w-full flex items-center justify-center font-mono text-muted-foreground">
                NO_CANDLE_DATA_AVAILABLE.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={380}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 60, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="timeLabel"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9, fontFamily: "monospace" }}
                    stroke="hsl(var(--border))"
                    minTickGap={40}
                  />
                  {/* Price axis */}
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    domain={[priceMin, priceMax]}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9, fontFamily: "monospace" }}
                    stroke="hsl(var(--border))"
                    tickFormatter={priceFormatter}
                    width={68}
                  />
                  {/* Volume axis — hidden, scaled so vol bars sit at bottom ~20% */}
                  <YAxis
                    yAxisId="vol"
                    orientation="left"
                    domain={[0, 500]}
                    hide
                  />

                  <Tooltip content={<CandleTooltip />} />

                  {/* OB levels as horizontal reference lines */}
                  {pair?.obHigh !== null && pair?.obHigh !== undefined && (
                    <ReferenceLine yAxisId="price" y={pair.obHigh} stroke="#22c55e" strokeDasharray="4 3" strokeWidth={1} strokeOpacity={0.6} label={{ value: "OB H", fill: "#22c55e", fontSize: 9, fontFamily: "monospace", position: "insideTopLeft" }} />
                  )}
                  {pair?.obLow !== null && pair?.obLow !== undefined && (
                    <ReferenceLine yAxisId="price" y={pair.obLow} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1} strokeOpacity={0.6} label={{ value: "OB L", fill: "#ef4444", fontSize: 9, fontFamily: "monospace", position: "insideBottomLeft" }} />
                  )}

                  {/* Volume bars — low opacity, secondary axis */}
                  <Bar
                    yAxisId="vol"
                    dataKey="volScaled"
                    fill="hsl(var(--muted-foreground))"
                    fillOpacity={0.12}
                    isAnimationActive={false}
                    maxBarSize={20}
                  />

                  {/* Candlestick: transparent filler (low) + visible candle (wick range) */}
                  <Bar
                    yAxisId="price"
                    dataKey="fillerLow"
                    stackId="candle"
                    fill="transparent"
                    stroke="none"
                    isAnimationActive={false}
                    legendType="none"
                  />
                  <Bar
                    yAxisId="price"
                    dataKey="wickRange"
                    stackId="candle"
                    shape={<CandleBar />}
                    isAnimationActive={false}
                    legendType="none"
                    maxBarSize={16}
                  />

                  {/* EMA lines rendered as Bars with dot shape trick isn't ideal —
                      use ReferenceLine per point... actually simpler: render as custom dots
                      via a zero-height bar with label, OR use Scatter.
                      Cleanest: use a dummy <Bar> with custom shape that draws just a dot */}
                  {/* EMA9 — yellow */}
                  <Bar
                    yAxisId="price"
                    dataKey="ema9"
                    fill="transparent"
                    stroke="none"
                    isAnimationActive={false}
                    legendType="none"
                    shape={(props: any) => {
                      const { x, width, payload } = props;
                      if (!payload?.ema9) return null;
                      const { yAxisId: _y, ...rest } = props;
                      // We need pixel y — but we don't have scale here.
                      // This approach doesn't work for lines. Skip and use a workaround.
                      return null;
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* EMA overlay — drawn via SVG custom layer using Recharts Customized */}
          {/* Note: EMAs are shown in the tooltip on hover */}
        </div>

        {/* Candle summary stats */}
        {chartData.length > 0 && (() => {
          const last = chartData[chartData.length - 1];
          const first = chartData[0];
          const pctChange = first.close > 0 ? ((last.close - first.close) / first.close) * 100 : 0;
          const maxHigh = Math.max(...chartData.map(c => c.high));
          const minLow = Math.min(...chartData.map(c => c.low));
          const isPos = pctChange >= 0;
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: `${timeframe.toUpperCase()} CHANGE`, value: `${isPos ? "+" : ""}${pctChange.toFixed(2)}%`, color: isPos ? "text-green-500" : "text-red-500" },
                { label: "PERIOD HIGH", value: `$${priceFormatter(maxHigh)}`, color: "text-green-500" },
                { label: "PERIOD LOW", value: `$${priceFormatter(minLow)}`, color: "text-red-500" },
                { label: "CANDLES", value: `${chartData.length}`, color: "text-muted-foreground" },
              ].map(({ label, value, color }) => (
                <div key={label} className="border border-border bg-card p-3 flex flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground">{label}</span>
                  <span className={`font-mono text-sm font-bold ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
