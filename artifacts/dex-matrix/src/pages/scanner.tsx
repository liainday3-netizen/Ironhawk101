import { useEffect, useState } from "react";
import { useListSignals, useCreateSignal } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Badge, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, AnimatedPulse } from "@/components/ui/core";
import { useQueryClient } from "@tanstack/react-query";
import { getListSignalsQueryKey, getListActiveSignalsQueryKey } from "@workspace/api-client-react";
import { formatNumber } from "@/lib/utils";

export default function Scanner() {
  const { data: signals, isLoading } = useListSignals();
  const createSignal = useCreateSignal();
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(true);

  // Client-side dummy signal generation to simulate live microstructure scanning
  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => {
      // 10% chance to generate a signal every tick (30s)
      if (Math.random() > 0.9) {
        const assets = ["SOL", "PEPE", "WIF", "ETH", "LINK", "BONK"];
        const chains = ["solana", "ethereum", "base"];
        const states = ["BULL_EXEC", "BEAR_EXEC", "IN_HTF_POI"];
        
        const asset = assets[Math.floor(Math.random() * assets.length)];
        const chain = chains[Math.floor(Math.random() * chains.length)];
        const state = states[Math.floor(Math.random() * states.length)];
        
        createSignal.mutate({
          data: {
            asset,
            chain,
            state,
            ltfMessage: state.includes("BULL") ? "M1_MSS_BULL" : state.includes("BEAR") ? "M1_MSS_BEAR" : "WAITING_CONF",
            htfMessage: "H4_OB_TEST",
            volumeZScore: Number((Math.random() * 3 + 1).toFixed(2)),
            obHigh: Number((Math.random() * 100 + 10).toFixed(2)),
            obLow: Number((Math.random() * 100).toFixed(2))
          }
        }, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListSignalsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListActiveSignalsQueryKey() });
          }
        });
      }
    }, 10000); // Poll every 10s for simulation
    return () => clearInterval(interval);
  }, [scanning, createSignal, queryClient]);

  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between border-primary/20 bg-primary/5">
        <div className="flex items-center gap-3">
          <span className="text-primary font-bold">LIVE_MICROSTRUCTURE_MATRIX</span>
          {scanning && <AnimatedPulse color="primary" />}
        </div>
        <button 
          onClick={() => setScanning(!scanning)}
          className="text-[10px] uppercase border border-border px-2 py-1 hover:bg-muted"
        >
          {scanning ? "PAUSE_SCAN" : "RESUME_SCAN"}
        </button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ASSET/CHAIN</TableHead>
              <TableHead>SIGNAL_STATE</TableHead>
              <TableHead>HTF_CACHE</TableHead>
              <TableHead>LTF_LOGIC</TableHead>
              <TableHead>VOL_Z_SCORE</TableHead>
              <TableHead>OB_ZONE</TableHead>
              <TableHead>TIME</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground animate-pulse font-bold tracking-widest">INITIALIZING_MATRIX_SCANNERS...</TableCell></TableRow>
            ) : signals && signals.length > 0 ? (
              signals.map(sig => {
                const isBull = sig.state.includes('BULL');
                const isBear = sig.state.includes('BEAR');
                const isPoi = sig.state.includes('POI');
                
                return (
                  <TableRow key={sig.id} className="group">
                    <TableCell>
                      <div className="font-bold text-foreground">{sig.asset}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{sig.chain}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isBull && <AnimatedPulse color="success" />}
                        {isBear && <AnimatedPulse color="danger" />}
                        {isPoi && <AnimatedPulse color="warning" />}
                        <Badge variant={isBull ? 'success' : isBear ? 'danger' : isPoi ? 'warning' : 'outline'}>
                          {sig.state}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{sig.htfMessage}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{sig.ltfMessage}</TableCell>
                    <TableCell>
                      {sig.volumeZScore && (
                        <span className={sig.volumeZScore > 2 ? "text-[#00ff88] font-bold" : "text-muted-foreground"}>
                          {formatNumber(sig.volumeZScore)}z
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {sig.obLow && sig.obHigh ? `[${sig.obLow} - ${sig.obHigh}]` : '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(sig.createdAt).toLocaleTimeString()}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">AWAITING_SIGNALS</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
