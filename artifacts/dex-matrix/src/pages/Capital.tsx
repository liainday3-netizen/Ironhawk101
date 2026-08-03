import { useGetCapital, getGetCapitalQueryKey, useGetPerformance, getGetPerformanceQueryKey, useUpdateCapital } from "@workspace/api-client-react";
import type { CapitalSummary } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, DollarSign, Zap, Shield, Target } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const CHAIN_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  ethereum: { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  base: { text: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/30" },
  solana: { text: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
};

const TIER_COLORS: Record<string, string> = {
  MICRO: "text-gray-400",
  STARTER: "text-yellow-400",
  CONSERVATIVE: "text-blue-400",
  STANDARD: "text-cyan-400",
  GROWTH: "text-green-400",
  AGGRESSIVE: "text-orange-400",
  INSTITUTIONAL: "text-red-400",
};

export default function Capital() {
  const queryClient = useQueryClient();
  const { data: capitals = [], isLoading } = useGetCapital({
    query: { refetchInterval: 15000, queryKey: getGetCapitalQueryKey() }
  });
  const { data: performance } = useGetPerformance({
    query: { refetchInterval: 15000, queryKey: getGetPerformanceQueryKey() }
  });

  const updateCapital = useUpdateCapital();
  const [editChain, setEditChain] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Partial<CapitalSummary>>({});

  const handleSave = (chain: string) => {
    updateCapital.mutate(
      { data: { chain, ...editValues } as any },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCapitalQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPerformanceQueryKey() });
          setEditChain(null);
          setEditValues({});
        }
      }
    );
  };

  if (isLoading) {
    return <div className="p-6 font-mono text-muted-foreground animate-pulse">LOADING_CAPITAL_DATA...</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold font-mono text-foreground tracking-tight flex items-center gap-2">
          <TrendingUp className="text-primary" />
          CAPITAL_SCALING_ENGINE
        </h1>
        <p className="text-sm font-mono text-muted-foreground mt-1">
          PROFIT_MONSTER_2026-2027 — Compound position sizing from $10 across all chains
        </p>
      </div>

      {/* Global Performance */}
      {performance && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard icon={<DollarSign size={14} />} label="TOTAL_PNL" value={`${performance.totalPnlUsd >= 0 ? "+" : ""}$${performance.totalPnlUsd.toFixed(2)}`} color={performance.totalPnlUsd >= 0 ? "text-green-500" : "text-red-500"} />
          <StatCard icon={<TrendingUp size={14} />} label="TOTAL_ROI" value={`${performance.totalReturnPct >= 0 ? "+" : ""}${performance.totalReturnPct.toFixed(2)}%`} color={performance.totalReturnPct >= 0 ? "text-green-500" : "text-red-500"} />
          <StatCard icon={<Target size={14} />} label="WIN_RATE" value={`${performance.winRate.toFixed(1)}%`} color="text-primary" />
          <StatCard icon={<Zap size={14} />} label="TOTAL_TRADES" value={String(performance.totalTrades)} color="text-foreground" />
          <StatCard icon={<Shield size={14} />} label="OPEN_POSITIONS" value={String(performance.openPositions)} color="text-yellow-400" />
        </div>
      )}

      {/* Per-chain cards */}
      <div className="flex flex-col gap-4">
        {capitals.map((cap: CapitalSummary) => {
          const colors = CHAIN_COLORS[cap.chain] || { text: "text-foreground", bg: "bg-secondary", border: "border-border" };
          const tierColor = TIER_COLORS[cap.scalingTier] || "text-foreground";
          const isEditing = editChain === cap.chain;
          const returnPct = cap.totalReturnPct;

          return (
            <div key={cap.chain} className={`border ${colors.border} bg-card`}>
              {/* Chain header */}
              <div className={`flex items-center justify-between px-4 py-3 border-b ${colors.border} ${colors.bg}`}>
                <div className="flex items-center gap-3">
                  <span className={`font-mono font-bold text-lg ${colors.text}`}>{cap.chain.toUpperCase()}</span>
                  <span className={`font-mono text-xs font-bold px-2 py-0.5 border ${colors.border} ${tierColor}`}>
                    {cap.scalingTier}
                  </span>
                  <span className={`font-mono text-xs px-2 py-0.5 border ${cap.autoExecute ? "border-green-500/40 bg-green-500/10 text-green-500" : "border-border text-muted-foreground"}`}>
                    {cap.autoExecute ? "AUTO_ON" : "MANUAL"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-xs ${returnPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                    {returnPct >= 0 ? "+" : ""}{returnPct.toFixed(2)}% ROI
                  </span>
                  <button
                    onClick={() => {
                      if (isEditing) {
                        setEditChain(null);
                        setEditValues({});
                      } else {
                        setEditChain(cap.chain);
                      }
                    }}
                    className="font-mono text-xs px-3 py-1 border border-border hover:border-primary text-muted-foreground hover:text-primary transition-colors"
                  >
                    {isEditing ? "CANCEL" : "CONFIG"}
                  </button>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-y divide-border">
                <div className="p-4 flex flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground">START_CAPITAL</span>
                  <span className="font-mono text-sm font-bold text-foreground">${cap.initialCapital.toFixed(2)}</span>
                </div>
                <div className="p-4 flex flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground">CURRENT_CAPITAL</span>
                  <span className="font-mono text-sm font-bold text-green-500">${cap.currentCapital.toFixed(2)}</span>
                </div>
                <div className="p-4 flex flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground">NEXT_POSITION</span>
                  <span className="font-mono text-sm font-bold text-primary">${cap.nextPositionSizeUsd.toFixed(2)}</span>
                </div>
                <div className="p-4 flex flex-col gap-1">
                  <span className="font-mono text-xs text-muted-foreground">WIN / LOSS</span>
                  <span className="font-mono text-sm font-bold">
                    <span className="text-green-500">{cap.wins}W</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-red-500">{cap.losses}L</span>
                  </span>
                </div>
              </div>

              {/* Edit form */}
              {isEditing && (
                <div className="border-t border-border p-4 flex flex-col gap-4">
                  <div className="font-mono text-xs text-muted-foreground">CONFIGURE_{cap.chain.toUpperCase()}_PARAMETERS</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <ConfigField
                      label="RISK_PCT"
                      defaultValue={cap.riskPct}
                      onChange={(v) => setEditValues(prev => ({ ...prev, riskPct: v }))}
                    />
                    <ConfigField
                      label="AUTO_EXECUTE"
                      defaultValue={cap.autoExecute ? 1 : 0}
                      onChange={(v) => setEditValues(prev => ({ ...prev, autoExecute: v === 1 } as any))}
                      hint="1=ON, 0=OFF"
                    />
                  </div>
                  {cap.walletAddress && (
                    <div className="font-mono text-xs text-muted-foreground">
                      WALLET: <span className="text-foreground">{cap.walletAddress}</span>
                    </div>
                  )}
                  <button
                    onClick={() => handleSave(cap.chain)}
                    disabled={updateCapital.isPending}
                    className="self-start px-6 py-2 bg-primary/10 border border-primary text-primary font-mono text-xs font-bold hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {updateCapital.isPending ? "SAVING..." : "SAVE_CONFIG"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="border border-border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`font-mono text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

function ConfigField({ label, defaultValue, onChange, hint }: { label: string; defaultValue: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-xs text-muted-foreground">{label}{hint && <span className="opacity-50"> ({hint})</span>}</label>
      <input
        type="number"
        defaultValue={defaultValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-background border border-border px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:border-primary transition-colors"
      />
    </div>
  );
}
