import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, Show, SignIn, SignUp } from "@clerk/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Route, Switch, Router as WouterRouter, Link, Redirect } from "wouter";
import { Layout } from "./components/Layout";
import Home from "./pages/Home";
import Signals from "./pages/Signals";
import Market from "./pages/Market";
import PairDetail from "./pages/PairDetail";
import Capital from "./pages/Capital";
import { useEffect, type ReactNode } from "react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function DarkModeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  return <>{children}</>;
}

function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md flex flex-col items-center gap-6">
        <img src={`${basePath}/logo.svg`} alt="IronHawk DEX Matrix" className="h-14 w-14" />
        {children}
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-3xl border border-border bg-card p-8 md:p-12">
        <div className="flex items-center gap-4 mb-8">
          <img src={`${basePath}/logo.svg`} alt="" className="h-14 w-14" />
          <div>
            <div className="text-primary font-mono text-xs font-bold tracking-[0.25em]">
              IRONHAWK_SYSTEM
            </div>
            <h1 className="text-3xl md:text-5xl font-bold font-mono tracking-tight">
              DEX_MATRIX
            </h1>
          </div>
        </div>
        <p className="max-w-2xl text-muted-foreground font-mono leading-7">
          Authenticated multi-chain market intelligence and on-chain execution
          terminal for Ethereum, Base, and Solana.
        </p>
        <div className="flex flex-wrap gap-3 mt-8">
          <Link
            href="/sign-in"
            className="border border-primary bg-primary/10 px-5 py-3 text-primary font-mono text-sm font-bold hover:bg-primary/20"
          >
            SIGN_IN
          </Link>
          <Link
            href="/sign-up"
            className="border border-border px-5 py-3 text-foreground font-mono text-sm font-bold hover:border-primary hover:text-primary"
          >
            CREATE_ACCOUNT
          </Link>
        </div>
        <div className="mt-10 border-t border-border pt-5 text-xs text-muted-foreground font-mono">
          LIVE_TRADING_REQUIRES_AUTHENTICATION_AND_EXPLICIT_OWNER_CONFIGURATION.
        </div>
      </div>
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/terminal" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function AuthenticatedTerminal() {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Switch>
            <Route path="/terminal" component={Home} />
            <Route path="/signals" component={Signals} />
            <Route path="/market" component={Market} />
            <Route path="/pair/:id" component={PairDetail} />
            <Route path="/capital" component={Capital} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route component={AuthenticatedTerminal} />
    </Switch>
  );
}

function SignInPage() {
  return (
    <AuthCard>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </AuthCard>
  );
}

function SignUpPage() {
  return (
    <AuthCard>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </AuthCard>
  );
}

function App() {
  const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      proxyUrl={clerkProxyUrl}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
    >
      <QueryClientProvider client={queryClient}>
        <DarkModeProvider>
          <TooltipProvider>
            <WouterRouter base={basePath}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </DarkModeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;