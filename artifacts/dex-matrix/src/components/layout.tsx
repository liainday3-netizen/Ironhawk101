import { Link, useLocation } from "wouter";
import { SiSolana, SiEthereum, SiBitcoin } from "react-icons/si";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/use-wallet";
import { usePriceFeed } from "@/hooks/use-price-feed";
import { AnimatedPulse } from "./ui/core";
import { formatCurrency } from "@/lib/utils";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { evm, solana } = useWallet();
  const prices = usePriceFeed();

  const nav = [
    { href: "/", label: "DASHBOARD" },
    { href: "/trade", label: "TRADE_PANEL" },
    { href: "/scanner", label: "SIGNAL_SCANNER" },
    { href: "/portfolio", label: "PORTFOLIO" },
    { href: "/watchlist", label: "WATCHLIST" },
    { href: "/history", label: "TRADE_HISTORY" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex font-mono selection:bg-primary selection:text-primary-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg tracking-tighter text-primary">IRONHAWK_</span>
            <span className="text-xs bg-primary text-primary-foreground px-1 py-0.5 font-bold">DEX</span>
          </div>
        </div>
        <nav className="flex-1 py-6 flex flex-col gap-2 px-3">
          {nav.map(item => {
            const active = location === item.href;
            return (
              <Link key={item.href} href={item.href} className={cn(
                "px-3 py-2 text-xs tracking-widest hover:text-primary transition-all flex items-center border border-transparent",
                active ? "text-primary border-primary bg-primary/10" : "text-muted-foreground hover:border-border"
              )}>
                {active && <span className="mr-2 text-primary">►</span>}
                {item.label}
              </Link>
            )
          })}
        </nav>
        
        {/* Connection Status Panel */}
        <div className="p-4 border-t border-border flex flex-col gap-4">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase mb-2 flex justify-between">
              <span>SYS_CONN</span>
              <AnimatedPulse color="primary" />
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <SiEthereum className={cn(evm.connected ? "text-primary" : "")} /> 
                  <span className={cn(evm.connected ? "text-primary" : "")}>ETH_NET</span>
                </div>
                <span className={evm.connected ? "text-primary" : "text-muted-foreground"}>{evm.connected ? "ON" : "OFF"}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <SiSolana className={cn(solana.connected ? "text-primary" : "")} /> 
                  <span className={cn(solana.connected ? "text-primary" : "")}>SOL_NET</span>
                </div>
                <span className={solana.connected ? "text-primary" : "text-muted-foreground"}>{solana.connected ? "ON" : "OFF"}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header - Ticker Tape */}
        <header className="h-12 border-b border-border flex items-center px-6 justify-between shrink-0 bg-card overflow-hidden">
          <div className="flex gap-8 text-xs font-bold items-center w-full animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">BTC_USD</span>
              <span className="text-primary">{formatCurrency(prices.btc)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">ETH_USD</span>
              <span className="text-primary">{formatCurrency(prices.eth)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">SOL_USD</span>
              <span className="text-primary">{formatCurrency(prices.sol)}</span>
            </div>
            <div className="flex-1" />
            <div className="text-[10px] text-muted-foreground tracking-widest animate-pulse border border-primary/20 px-2 py-0.5 bg-primary/5 text-primary">
              LIVE_FEED_ACTIVE
            </div>
          </div>
        </header>

        {/* Dynamic Canvas */}
        <div className="flex-1 overflow-auto bg-[#030509] p-6 relative">
          {/* subtle scanline overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-5 bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,255,136,0.1)_50%)] bg-[length:100%_4px]" />
          
          <div className="relative z-10 max-w-[1600px] mx-auto">
            <div className="mb-6 flex items-center gap-4">
               <h1 className="text-2xl font-bold tracking-tight uppercase text-foreground">
                 {nav.find(n => n.href === location)?.label?.replace('_', ' ') || "SYS_ERROR"}
               </h1>
               <div className="h-px bg-border flex-1" />
            </div>
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
