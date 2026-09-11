---
name: IronHawk DEX Matrix Architecture
description: Architecture decisions and schema after merging user's GitHub repo code into the project
---

## DB Schema (after merge)
Four tables: `watched_pairs`, `signals`, `positions`, `capital_config`
Old tables (`trades`, `signals`, `capital_snapshots`, `watchlist`) were dropped and replaced.

## API Routes
- `/api/scanner/pairs` — watched pair watchlist + microstructure state
- `/api/scanner/signals` — signal execution history
- `/api/scanner/stats` — aggregate counts
- `/api/market/search`, `/api/market/trending`, `/api/market/candles` — DexScreener + GeckoTerminal (no API key)
- `/api/trader/positions`, `/api/trader/capital`, `/api/trader/performance`, `/api/trader/execute` — capital scaling + on-chain execution

## Key Engine Files (artifacts/api-server/src/lib/)
- `microstructure.ts` — TypeScript port of MQ5 (order block, CHoCH, volume z-score, killzones)
- `capitalScaling.ts` — compound scaling tiers: MICRO→STARTER→CONSERVATIVE→STANDARD→GROWTH→AGGRESSIVE→INSTITUTIONAL
- `scanner.ts` — 30s scan cycle, fires signals on state transition to BULL_EXEC/BEAR_EXEC
- `marketData.ts` — DexScreener (search/pair info) + GeckoTerminal (OHLCV, trending)
- `evmExecutor.ts` — Uniswap V3 Universal Router via viem, publicnode.com RPCs
- `solanaExecutor.ts` — Jupiter v6 REST API via @solana/web3.js
- `tradeExecutor.ts` — signal → execution pipeline, TP/SL monitoring

## Scanner starts on server boot
`app.ts` calls `startScanner()` — runs 2s after boot, then every 30s

**Why:** User's repo had far more complete logic (real on-chain executors, live OHLCV, compound scaling) than the placeholder backend built initially. Full replacement was necessary.

## Packages added to api-server
`viem`, `@solana/web3.js`, `bs58`

## On-chain execution requires wallet secrets and explicit server gates
- EVM: `EVM_WALLET_PRIVATE_KEY` or `BASE_WALLET_PRIVATE_KEY`
- Solana: `SOLANA_WALLET_PRIVATE_KEY` (base58 or JSON array)
Without these, execution fails safely. Live execution also requires `TRADING_ENABLED=true`
and a non-empty `TRADING_ALLOWED_USER_IDS` allowlist; Clerk authentication protects all
non-health API routes, and owner authorization protects mutations.

**Why:** The API owns funded-wallet execution and persists global trading state, so an
authenticated-but-unapproved user must not be able to trade or change capital/watchlists.

**How to apply:** Keep the kill switch and owner allowlist unset during development and
until wallet, market-data, and emergency-close behavior have been verified.
