import { useGetPortfolioSummary, useListRecentTrades, useListActiveSignals } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Badge, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, AnimatedPulse } from "@/components/ui/core";
import { formatCurrency, formatPercent, truncateHash, cn } from "@/lib/utils";
import { SiSolana, SiEthereum, SiBitcoin } from "react-icons/si";
import { ArrowUpRight, ArrowDownRight, Activity } from "lucide-react";

function ChainIcon({ chain }: { chain: string }) {
  switch (chain.toLowerCase()) {
    case 'solana': return <SiSolana className="text-[#14F195]" />;
    case 'ethereum': return <SiEthereum className="text-[#627EEA]" />;
    case 'base': return <div className="w-3 h-3 rounded-full bg-[#0052FF]" />;
    case 'bitcoin': return <SiBitcoin className="text-[#F7931A]" />;
    default: return <Activity className="w-3 h-3" />;
  }
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetPortfolioSummary();
  const { data: trades, isLoading: loadingTrades } = useListRecentTrades();
  const { data: signals, isLoading: loadingSignals } = useListActiveSignals();

  if (loadingSummary) {
    return <div className="text-primary animate-pulse font-bold tracking-widest">LOADING_MATRIX_DATA...</div>;
  }

  const { currentCapitalUsd = 10, totalPnlUsd = 0, roiPercent = 0, chainBreakdown = [] } = summary || {};
  const isProfitable = totalPnlUsd >= 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* Portfolio Card */}
      <Card className="lg:col-span-2 border-primary/30">
        <CardHeader className="bg-primary/5 text-primary border-primary/30">PORTFOLIO_OVERVIEW</CardHeader>
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row gap-8 items-start md:items-end justify-between">
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-widest mb-2">NET_LIQUIDITY (USD)</div>
              <div className="text-6xl font-bold text-foreground tracking-tighter">
                {formatCurrency(currentCapitalUsd)}
              </div>
              <div className="flex gap-4 mt-4">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">ALL_TIME_PNL</span>
                  <span className={cn("text-lg font-bold flex items-center gap-1", isProfitable ? "text-[#00ff88]" : "text-[#ff3366]")}>
                    {isProfitable ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                    {formatCurrency(totalPnlUsd)}
                  </span>
                </div>
                <div className="w-px bg-border" />
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase">ROI</span>
                  <span className={cn("text-lg font-bold", isProfitable ? "text-[#00ff88]" : "text-[#ff3366]")}>
                    {isProfitable ? '+' : ''}{formatPercent(roiPercent)}
                  </span>
                </div>
              </div>
            </div>
            
            {/* Chain Allocations */}
            <div className="w-full md:w-auto flex-1 md:max-w-xs flex flex-col gap-3">
              <div className="text-xs text-muted-foreground uppercase tracking-widest border-b border-border pb-2 mb-1">ALLOCATION_MATRIX</div>
              {chainBreakdown.map((cb) => (
                <div key={cb.chain} className="flex items-center gap-3 text-sm">
                  <ChainIcon chain={cb.chain} />
                  <div className="flex-1 uppercase font-bold text-muted-foreground">{cb.chain}</div>
                  <div className="text-foreground">{formatCurrency(cb.balanceUsd)}</div>
                  <div className="w-12 text-right text-xs text-muted-foreground">{formatPercent(cb.allocation)}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Signals Feed */}
      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <span>ACTIVE_SIGNALS</span>
          <AnimatedPulse color="warning" />
        </CardHeader>
        <CardContent className="p-0 overflow-auto max-h-[300px]">
          {loadingSignals ? (
             <div className="p-4 text-xs text-muted-foreground animate-pulse">SCANNING_FREQUENCIES...</div>
          ) : signals && signals.length > 0 ? (
            <div className="divide-y divide-border border-b border-border">
              {signals.map(sig => (
                <div key={sig.id} className="p-4 hover:bg-muted/20 transition-colors flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ChainIcon chain={sig.chain} />
                    <div className="flex flex-col">
                      <span className="font-bold text-sm uppercase">{sig.asset}</span>
                      <span className="text-[10px] text-muted-foreground">{sig.chain.toUpperCase()}</span>
                    </div>
                  </div>
                  <Badge variant={sig.state.includes('BULL') ? 'success' : sig.state.includes('BEAR') ? 'danger' : 'warning'}>
                    {sig.state.replace('_EXEC', '')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-muted-foreground">NO_ACTIVE_SIGNALS</div>
          )}
        </CardContent>
      </Card>

      {/* Recent Trades */}
      <Card className="lg:col-span-3">
        <CardHeader>RECENT_EXECUTIONS</CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ASSET</TableHead>
                <TableHead>SIDE</TableHead>
                <TableHead>ENTRY_PRICE</TableHead>
                <TableHead>EXIT_PRICE</TableHead>
                <TableHead>AMOUNT</TableHead>
                <TableHead>PNL</TableHead>
                <TableHead>TX_HASH</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingTrades ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground animate-pulse">FETCHING_LEDGER...</TableCell></TableRow>
              ) : trades && trades.length > 0 ? (
                trades.map(trade => {
                  const isWin = trade.pnlUsd && trade.pnlUsd > 0;
                  const isLoss = trade.pnlUsd && trade.pnlUsd < 0;
                  return (
                    <TableRow key={trade.id}>
                      <TableCell className="font-bold">
                        <div className="flex items-center gap-2">
                          <ChainIcon chain={trade.chain} />
                          {trade.tokenSymbol}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={trade.side === 'buy' ? 'success' : 'danger'}>{trade.side}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatCurrency(trade.entryPriceUsd)}</TableCell>
                      <TableCell className="text-muted-foreground">{trade.exitPriceUsd ? formatCurrency(trade.exitPriceUsd) : '-'}</TableCell>
                      <TableCell>{formatCurrency(trade.amountUsd)}</TableCell>
                      <TableCell className={cn("font-bold", isWin ? "text-[#00ff88]" : isLoss ? "text-[#ff3366]" : "")}>
                        {trade.pnlUsd ? (
                          <div className="flex flex-col">
                            <span>{trade.pnlUsd > 0 ? '+' : ''}{formatCurrency(trade.pnlUsd)}</span>
                            {trade.pnlPercent && <span className="text-[10px]">{formatPercent(trade.pnlPercent)}</span>}
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{truncateHash(trade.txHash)}</TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">NO_TRADES_LOGGED</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      
    </div>
  );
}
