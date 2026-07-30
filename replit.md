# IronHawk DEX Matrix

A multi-chain DEX trading terminal with the IronHawk Microstructure Matrix signal engine. Tracks capital scaling from $10 across Solana, Ethereum, Base, and Bitcoin (WBTC), with order-block/CHOCH signal detection ported from the MQ5 quantitative scanner.

## Run & Operate

- `pnpm --filter @workspace/dex-matrix run dev` — run the frontend (port assigned by workflow)
- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, shadcn/ui, Recharts, Wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Wallets: MetaMask (EVM) + Phantom (Solana) via window.ethereum / window.solana

## Where things live

- `artifacts/dex-matrix/` — React frontend (trading terminal UI)
- `artifacts/api-server/src/routes/` — API routes: trades, signals, portfolio, watchlist
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema/` — Drizzle schema: trades, signals, capital_snapshots, watchlist
- `attached_assets/Microstructure_Matrix_1785374221638.mq5` — original MQ5 signal logic

## Architecture decisions

- Frontend-first DEX integration: wallet connection and price feeds are purely client-side via public RPCs and DeFiLlama's free coins API — no API keys required
- Backend is thin persistence only: stores trade history, capital snapshots, signal history, and watchlist; all trading logic runs in the browser
- Starting capital hardcoded at $10 in the portfolio summary route — update `artifacts/api-server/src/routes/portfolio.ts` to change
- All integer columns in OpenAPI spec use `type: number` (not `type: integer`) to avoid Zod v3 `.int()` codegen errors

## Product

- **Dashboard**: Portfolio capital tracker ($10 → current), chain allocation breakdown, active buy/sell signals, recent trade log
- **Trade Panel**: Multi-wallet connector (MetaMask + Phantom), token selector, position sizing, DEX swap execution (Uniswap V3 / Jupiter)
- **Signal Scanner**: IronHawk Microstructure Matrix — order-block detection, fractal CHOCH signals, volume z-score, color-coded states
- **Portfolio**: Capital growth chart, chain allocation donut, win rate, PnL history
- **Watchlist**: Token monitoring across all chains
- **Trade History**: Full trade log with signal context and tx hashes

## User preferences

- Dark mode only — this is a trading terminal, no light mode toggle
- No emojis in the UI
- Chains: Solana, Ethereum, Base, Bitcoin (WBTC)
- Starting capital: $10

## Gotchas

- After any OpenAPI spec change, run codegen before touching routes or frontend hooks
- `type: integer` in OpenAPI causes `zod.int()` errors (Zod v3) — use `type: number` everywhere
- Numeric DB columns (numeric/decimal) are returned as strings from Drizzle — always `Number()` them before sending to the client
- Express 5: `req.params.id` is `string | string[]` — always handle both cases before parseInt
