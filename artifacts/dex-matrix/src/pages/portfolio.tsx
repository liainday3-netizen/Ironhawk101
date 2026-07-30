import { useGetPortfolioSummary, useListCapitalSnapshots } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent } from "@/components/ui/core";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { formatCurrency, formatPercent } from "@/lib/utils";

export default function Portfolio() {
  const { data: summary } = useGetPortfolioSummary();
  const { data: snapshots } = useListCapitalSnapshots();

  const chartData = snapshots?.map(s => ({
    time: new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    value: s.totalUsd
  })).reverse() || [];

  const pieColors = ['#14F195', '#627EEA', '#0052FF', '#F7931A']; // SOL, ETH, BASE, BTC

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      
      {/* Equity Curve */}
      <Card className="lg:col-span-2 border-primary/20">
        <CardHeader className="bg-primary/5 text-primary border-primary/20">CAPITAL_GROWTH_CURVE</CardHeader>
        <CardContent className="p-6 h-[400px]">
           {chartData.length > 0 ? (
             <ResponsiveContainer width="100%" height="100%">
               <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                 <defs>
                   <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="5%" stopColor="#00ff88" stopOpacity={0.3}/>
                     <stop offset="95%" stopColor="#00ff88" stopOpacity={0}/>
                   </linearGradient>
                 </defs>
                 <XAxis dataKey="time" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                 <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                 <Tooltip 
                   contentStyle={{ backgroundColor: '#030509', border: '1px solid #1e293b', borderRadius: 0 }}
                   itemStyle={{ color: '#00ff88', fontWeight: 'bold' }}
                   labelStyle={{ color: '#64748b', fontSize: '12px' }}
                 />
                 <Area type="step" dataKey="value" stroke="#00ff88" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
               </AreaChart>
             </ResponsiveContainer>
           ) : (
             <div className="h-full flex items-center justify-center text-muted-foreground font-mono text-sm tracking-widest">
               INSUFFICIENT_DATA_POINTS
             </div>
           )}
        </CardContent>
      </Card>

      {/* Allocation Donut */}
      <Card>
        <CardHeader>ASSET_ALLOCATION</CardHeader>
        <CardContent className="flex items-center justify-center h-[300px]">
          {summary && summary.chainBreakdown && summary.chainBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={summary.chainBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="balanceUsd"
                  stroke="none"
                >
                  {summary.chainBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip 
                   contentStyle={{ backgroundColor: '#030509', border: '1px solid #1e293b', borderRadius: 0 }}
                   itemStyle={{ color: '#e2e8f0', fontWeight: 'bold' }}
                   formatter={(value: number) => formatCurrency(value)}
                 />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-muted-foreground text-xs uppercase tracking-widest">NO_ALLOCATIONS</div>
          )}
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <Card>
        <CardHeader>PERFORMANCE_METRICS</CardHeader>
        <CardContent className="p-6 flex flex-col justify-center gap-8">
           <div>
             <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">WIN_RATE</div>
             <div className="text-5xl font-bold text-primary">{formatPercent(summary?.winRate || 0)}</div>
             <div className="w-full bg-muted/30 h-2 mt-4 rounded-full overflow-hidden">
               <div className="bg-primary h-full" style={{ width: `${(summary?.winRate || 0)}%` }} />
             </div>
           </div>
           <div className="grid grid-cols-2 gap-4">
             <div className="border border-border p-4 bg-muted/10">
               <div className="text-[10px] text-muted-foreground uppercase mb-1">TOTAL_EXECUTIONS</div>
               <div className="text-2xl font-bold">{summary?.totalTrades || 0}</div>
             </div>
             <div className="border border-border p-4 bg-muted/10">
               <div className="text-[10px] text-muted-foreground uppercase mb-1">ROI_BASE_CAPITAL</div>
               <div className="text-2xl font-bold text-[#00ff88]">+{formatPercent(summary?.roiPercent || 0)}</div>
             </div>
           </div>
        </CardContent>
      </Card>

    </div>
  )
}
