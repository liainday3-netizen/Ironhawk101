import { useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { usePriceFeed } from "@/hooks/use-price-feed";
import { useCreateTrade, useGetPortfolioSummary } from "@workspace/api-client-react";
import { Card, CardHeader, CardContent, Button, Input, Badge } from "@/components/ui/core";
import { cn, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListTradesQueryKey, getGetPortfolioSummaryQueryKey, getListRecentTradesQueryKey } from "@workspace/api-client-react";

export default function TradePanel() {
  const { evm, solana, connectEvm, connectSolana, disconnectEvm, disconnectSolana } = useWallet();
  const prices = usePriceFeed();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createTrade = useCreateTrade();
  const { data: summary } = useGetPortfolioSummary();

  const [chain, setChain] = useState<"ethereum" | "base" | "solana">("ethereum");
  const [symbol, setSymbol] = useState("");
  const [address, setAddress] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [executing, setExecuting] = useState(false);

  const activeWallet = chain === "solana" ? solana : evm;
  const isConnected = activeWallet.connected;

  const currentPrice = chain === "solana" ? prices.sol : prices.eth; // extremely simplified mock price assumption

  const handleExecute = async () => {
    if (!isConnected) {
      toast({ title: "SYS_ERR", description: "WALLET_NOT_CONNECTED", variant: "destructive" });
      return;
    }
    if (!symbol || !amountUsd) {
      toast({ title: "SYS_ERR", description: "MISSING_PARAMETERS", variant: "destructive" });
      return;
    }

    setExecuting(true);
    // Fake execution delay for immersion
    await new Promise(r => setTimeout(r, 1500));

    const entryPrice = currentPrice + (Math.random() * currentPrice * 0.01); // mock slippage

    createTrade.mutate({
      data: {
        chain,
        tokenSymbol: symbol.toUpperCase(),
        tokenAddress: address || null,
        side,
        entryPriceUsd: entryPrice,
        amountUsd: Number(amountUsd),
        txHash: "0x" + Math.random().toString(16).slice(2, 42) // fake hash
      }
    }, {
      onSuccess: () => {
        toast({ title: "EXEC_SUCCESS", description: `TRADE_LOGGED_ON_${chain.toUpperCase()}` });
        setSymbol("");
        setAddress("");
        setAmountUsd("");
        setExecuting(false);
        queryClient.invalidateQueries({ queryKey: getListTradesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRecentTradesQueryKey() });
      },
      onError: (err) => {
        toast({ title: "EXEC_FAILED", description: String(err), variant: "destructive" });
        setExecuting(false);
      }
    });
  };

  const handleSizing = (percent: number) => {
    if (summary && summary.currentCapitalUsd) {
      setAmountUsd((summary.currentCapitalUsd * percent).toFixed(2));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      
      {/* Wallet Connection */}
      <div className="lg:col-span-3 flex flex-col gap-6">
        <Card>
          <CardHeader>SYS_AUTH / WALLETS</CardHeader>
          <CardContent className="flex flex-col gap-4">
            {/* EVM */}
            <div className="p-4 border border-border bg-muted/10 rounded-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="font-bold text-sm">EVM_NODE</span>
                <Badge variant={evm.connected ? "success" : "outline"}>{evm.connected ? "ONLINE" : "OFFLINE"}</Badge>
              </div>
              {evm.connected ? (
                <div className="flex flex-col gap-2 text-xs">
                  <span className="text-muted-foreground truncate">{evm.address}</span>
                  <span className="text-primary font-bold">{evm.balance?.toFixed(4)} NATIVE</span>
                  <Button variant="outline" size="sm" onClick={disconnectEvm} className="mt-2 text-[10px]">DISCONNECT</Button>
                </div>
              ) : (
                <Button size="sm" className="w-full" onClick={connectEvm}>CONNECT_METAMASK</Button>
              )}
            </div>

            {/* Solana */}
            <div className="p-4 border border-border bg-muted/10 rounded-sm">
              <div className="flex justify-between items-center mb-3">
                <span className="font-bold text-sm">SOL_NODE</span>
                <Badge variant={solana.connected ? "success" : "outline"}>{solana.connected ? "ONLINE" : "OFFLINE"}</Badge>
              </div>
              {solana.connected ? (
                <div className="flex flex-col gap-2 text-xs">
                  <span className="text-muted-foreground truncate">{solana.address}</span>
                  <span className="text-primary font-bold">{solana.balance?.toFixed(4)} SOL</span>
                  <Button variant="outline" size="sm" onClick={disconnectSolana} className="mt-2 text-[10px]">DISCONNECT</Button>
                </div>
              ) : (
                <Button size="sm" className="w-full" onClick={connectSolana}>CONNECT_PHANTOM</Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trade Execution Panel */}
      <div className="lg:col-span-6">
        <Card className="h-full border-primary/20">
          <CardHeader className="bg-primary/5 text-primary border-primary/20 flex flex-row items-center justify-between">
            <span>EXECUTION_MODULE</span>
            <span className="text-[#00ff88] animate-pulse text-[10px] tracking-widest">AWAITING_INPUT</span>
          </CardHeader>
          <CardContent className="p-6">
            
            {/* Chain Select */}
            <div className="flex gap-2 mb-6">
              {(["ethereum", "base", "solana"] as const).map(c => (
                <Button 
                  key={c}
                  variant={chain === c ? "default" : "outline"}
                  onClick={() => setChain(c)}
                  className="flex-1"
                >
                  {c.toUpperCase()}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground uppercase">TICKER_SYMBOL</label>
                <Input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="e.g. PEPE" />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground uppercase">CONTRACT_ADDRESS (OPT)</label>
                <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="0x..." />
              </div>
            </div>

            {/* Position Sizing */}
            <div className="space-y-2 mb-6 border p-4 border-border bg-black/50">
              <div className="flex justify-between">
                 <label className="text-xs text-muted-foreground uppercase">SIZE_USD</label>
                 <span className="text-xs text-primary font-bold">CAP_AVAIL: {formatCurrency(summary?.currentCapitalUsd || 0)}</span>
              </div>
              <Input type="number" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} placeholder="0.00" className="text-xl font-bold h-12" />
              <div className="flex gap-2 pt-2">
                {[0.1, 0.25, 0.5, 1].map(pct => (
                  <Button key={pct} variant="outline" size="sm" onClick={() => handleSizing(pct)} className="flex-1 h-8 text-[10px]">
                    {pct * 100}%
                  </Button>
                ))}
              </div>
            </div>

            {/* Buy / Sell Toggles */}
            <div className="flex gap-4 mb-8">
              <button 
                onClick={() => setSide("buy")}
                className={cn("flex-1 h-14 border-2 font-bold text-lg tracking-widest uppercase transition-colors", side === "buy" ? "border-[#00ff88] bg-[#00ff88]/10 text-[#00ff88]" : "border-border text-muted-foreground hover:border-muted-foreground")}
              >
                BUY_MKT
              </button>
              <button 
                onClick={() => setSide("sell")}
                className={cn("flex-1 h-14 border-2 font-bold text-lg tracking-widest uppercase transition-colors", side === "sell" ? "border-[#ff3366] bg-[#ff3366]/10 text-[#ff3366]" : "border-border text-muted-foreground hover:border-muted-foreground")}
              >
                SELL_MKT
              </button>
            </div>

            {/* Execute */}
            <Button 
              size="lg" 
              className="w-full h-16 text-xl tracking-widest"
              variant={side === "buy" ? "success" : "danger"}
              disabled={executing || !isConnected}
              onClick={handleExecute}
            >
              {executing ? "EXECUTING_ROUTING..." : `EXECUTE_${side.toUpperCase()}_ORDER`}
            </Button>

          </CardContent>
        </Card>
      </div>

      {/* Order Book / Context */}
      <div className="lg:col-span-3">
        <Card className="h-full">
          <CardHeader>ORDER_BOOK / CONTEXT</CardHeader>
          <CardContent className="p-0">
             <div className="p-4 border-b border-border bg-muted/10">
               <div className="text-xs text-muted-foreground uppercase mb-1">DEX_ROUTE</div>
               <div className="text-sm font-bold text-primary flex items-center gap-2">
                 {chain === 'solana' ? 'JUPITER_V6' : 'UNISWAP_V3'}
               </div>
             </div>
             
             {/* Fake order book visual */}
             <div className="p-4 text-xs font-mono space-y-1">
               <div className="text-muted-foreground uppercase mb-2">SELL_WALL</div>
               {[...Array(5)].map((_, i) => (
                 <div key={i} className="flex justify-between text-[#ff3366]/70">
                   <span>{(currentPrice + (5-i)*0.05).toFixed(4)}</span>
                   <span>{(Math.random() * 1000).toFixed(2)}</span>
                 </div>
               ))}
               <div className="my-3 py-1 border-y border-border text-center font-bold text-primary text-sm">
                 {currentPrice.toFixed(4)}
               </div>
               <div className="text-muted-foreground uppercase mb-2">BUY_WALL</div>
               {[...Array(5)].map((_, i) => (
                 <div key={i} className="flex justify-between text-[#00ff88]/70">
                   <span>{(currentPrice - (i+1)*0.05).toFixed(4)}</span>
                   <span>{(Math.random() * 1000).toFixed(2)}</span>
                 </div>
               ))}
             </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
