import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import { Layout } from '@/components/layout';
import Dashboard from '@/pages/dashboard';
import TradePanel from '@/pages/trade';
import Scanner from '@/pages/scanner';
import Portfolio from '@/pages/portfolio';
import Watchlist from '@/pages/watchlist';
import History from '@/pages/history';

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/trade" component={TradePanel} />
        <Route path="/scanner" component={Scanner} />
        <Route path="/portfolio" component={Portfolio} />
        <Route path="/watchlist" component={Watchlist} />
        <Route path="/history" component={History} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
