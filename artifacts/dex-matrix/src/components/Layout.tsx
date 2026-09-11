import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useClerk, useUser } from "@clerk/react";
import { useGetScannerStats, getGetScannerStatsQueryKey } from "@workspace/api-client-react";
import { Activity, LayoutDashboard, History, Telescope, TerminalSquare, TrendingUp } from "lucide-react";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: stats } = useGetScannerStats({
    query: { refetchInterval: 10000, queryKey: getGetScannerStatsQueryKey() }
  });

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary selection:text-primary-foreground">
      {/* Top Stats Bar */}
      <header className="border-b border-border bg-card flex-none">
        <div className="flex items-center justify-between px-4 py-2 text-xs font-mono border-b border-border bg-background">
          <div className="flex items-center gap-2 text-primary font-bold tracking-wider">
            <TerminalSquare size={14} />
            <span>IRONHAWK_DEX_MATRIX // LIVE_TERMINAL</span>
          </div>
          <div className="flex items-center gap-4 text-muted-foreground">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <span>SYS_ONLINE</span>
            </div>
            <span className="hidden sm:block">{new Date().toISOString().split('T')[1].slice(0, -1)}Z</span>
            <button
              type="button"
              onClick={() => signOut()}
              className="border border-border px-2 py-1 text-[10px] font-bold hover:border-primary hover:text-primary"
              title={user?.primaryEmailAddress?.emailAddress ?? "Account"}
            >
              SIGN_OUT
            </button>
          </div>
        </div>

        <div className="flex items-center px-4 h-12 gap-6 font-mono text-sm overflow-x-auto whitespace-nowrap">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">WATCHED:</span>
            <span className="font-bold text-foreground">{stats?.totalPairs ?? 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">BULL_EXEC:</span>
            <span className="font-bold text-green-500">{stats?.activeBull ?? 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">BEAR_EXEC:</span>
            <span className="font-bold text-red-500">{stats?.activeBear ?? 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">IN_POI:</span>
            <span className="font-bold text-primary">{stats?.inPoi ?? 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">SIG/DAY:</span>
            <span className="font-bold text-foreground">{stats?.signalsToday ?? 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">SIG/TOTAL:</span>
            <span className="font-bold text-foreground">{stats?.signalsTotal ?? 0}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">ADAPTIVE_BLOCK:</span>
            <span className={`font-bold ${(stats?.adaptiveBlocked ?? 0) > 0 ? "text-yellow-400" : "text-green-500"}`}>
              {stats?.adaptiveBlocked ?? 0}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">AVG_CONF:</span>
            <span className="font-bold text-primary">{(stats?.averageConfidence ?? 0).toFixed(0)}%</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-16 lg:w-52 border-r border-border bg-card flex flex-col py-4 flex-none">
          <nav className="flex flex-col gap-1 px-2">
            <NavItem href="/terminal" icon={<LayoutDashboard size={18} />} label="MATRIX" active={location === "/terminal"} />
            <NavItem href="/signals" icon={<History size={18} />} label="SIGNALS" active={location === "/signals"} />
            <NavItem href="/market" icon={<Telescope size={18} />} label="MARKET" active={location === "/market"} />
            <NavItem href="/capital" icon={<TrendingUp size={18} />} label="CAPITAL" active={location === "/capital"} />
          </nav>

          {/* Chain breakdown in sidebar */}
          {stats && Object.keys(stats.chainBreakdown).length > 0 && (
            <div className="mt-auto px-3 pb-2 hidden lg:block">
              <div className="border border-border bg-background p-3">
                <div className="font-mono text-[10px] text-muted-foreground mb-2">CHAIN_DIST</div>
                {Object.entries(stats.chainBreakdown).map(([chain, count]) => (
                  <div key={chain} className="flex justify-between font-mono text-xs mb-1">
                    <span className="text-muted-foreground">{chain.toUpperCase()}</span>
                    <span className="text-foreground font-bold">{count as number}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItem({ href, icon, label, active }: { href: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link href={href} className={`flex items-center gap-3 px-3 py-3 font-mono text-sm transition-colors border ${active ? "bg-accent text-primary border-primary" : "text-muted-foreground border-transparent hover:border-border hover:bg-secondary hover:text-foreground"}`}>
      {icon}
      <span className="hidden lg:block">{label}</span>
    </Link>
  );
}
