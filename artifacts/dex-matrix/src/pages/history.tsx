import { useListTrades } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from "@/components/ui/core";
import { formatCurrency, formatPercent, truncateHash, cn } from "@/lib/utils";
import { SiSolana, SiEthereum, SiBitcoin } from "react-icons/si";

export default function History() {
  const { data: trades, isLoading } = useListTrades();

  return (
    <Card>
      <CardHeader>FULL_EXECUTION_LOG</CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>TIMESTAMP</TableHead>
              <TableHead>ASSET/CHAIN</TableHead>
              <TableHead>SIDE</TableHead>
              <TableHead>ENTRY</TableHead>
              <TableHead>EXIT</TableHead>
              <TableHead>SIZE</TableHead>
              <TableHead>PNL</TableHead>
              <TableHead>TRIGGER_SRC</TableHead>
              <TableHead>TX</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground animate-pulse font-bold tracking-widest">RETRIEVING_LOGS...</TableCell></TableRow>
            ) : trades && trades.length > 0 ? (
              trades.map(trade => {
                const isWin = trade.pnlUsd && trade.pnlUsd > 0;
                const isLoss = trade.pnlUsd && trade.pnlUsd < 0;
                
                return (
                  <TableRow key={trade.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(trade.createdAt).toLocaleString(undefined, {
                        month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
                      })}
                    </TableCell>
                    <TableCell>
                      <div className="font-bold flex items-center gap-2">
                        {trade.chain === 'solana' && <SiSolana className="text-[#14F195]" />}
                        {trade.chain === 'ethereum' && <SiEthereum className="text-[#627EEA]" />}
                        {trade.chain === 'base' && <div className="w-3 h-3 rounded-full bg-[#0052FF]" />}
                        {trade.chain === 'bitcoin' && <SiBitcoin className="text-[#F7931A]" />}
                        {trade.tokenSymbol}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={trade.side === 'buy' ? 'success' : 'danger'}>{trade.side}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono">{formatCurrency(trade.entryPriceUsd)}</TableCell>
                    <TableCell className="text-muted-foreground font-mono">{trade.exitPriceUsd ? formatCurrency(trade.exitPriceUsd) : '-'}</TableCell>
                    <TableCell className="font-mono">{formatCurrency(trade.amountUsd)}</TableCell>
                    <TableCell className={cn("font-bold font-mono", isWin ? "text-[#00ff88]" : isLoss ? "text-[#ff3366]" : "")}>
                      {trade.pnlUsd ? (
                        <div className="flex flex-col">
                          <span>{trade.pnlUsd > 0 ? '+' : ''}{formatCurrency(trade.pnlUsd)}</span>
                          {trade.pnlPercent && <span className="text-[10px] opacity-70">{formatPercent(trade.pnlPercent)}</span>}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell>
                      {trade.signalState ? (
                        <Badge variant="outline" className="border-primary/50 text-primary/80 text-[8px]">{trade.signalState}</Badge>
                      ) : (
                         <span className="text-[10px] text-muted-foreground">MANUAL</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {truncateHash(trade.txHash)}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow><TableCell colSpan={9} className="text-center py-12 text-muted-foreground">LOG_EMPTY</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
