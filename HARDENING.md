# IronHawk101 — Hardening Branch

This branch carries the audit findings and patches from a full read of the
engine, the execution pipeline and the deployment configuration. It is **not
merged**, and nothing in it enables live trading — the guard still refuses
every trade unless `TRADING_ENABLED`, `TRADING_CLOSES_ENABLED` and a non-empty
`TRADING_ALLOWED_USER_IDS` are all present in the deployed environment.

## ⚠ Freshly written code, not a verified change

The code in this branch was written from reading the repository. It has **not
been typechecked or run** — the environment it was written in had no network
access and could not install the dependency graph. Treat it as a reviewed
design that compiles in shape, not as a change that has been proven to build.

Run these before trusting any of it:

```bash
pnpm install --no-frozen-lockfile
pnpm run typecheck
pnpm run build
```

`P6` in particular is new logic touching both chain executors. It is the patch
most worth reading line by line before merging.

## The two defects worth your attention

**No resolver for `RECONCILIATION_REQUIRED`.** The executor correctly refuses to
blind-retry an unconfirmed swap and flags the position instead — but nothing
ever resolved the flag. Real on-chain exposure could sit permanently invisible
to the P&L and to the position count. `lib/reconcile.ts` is the resolver.

**Deployment target contradiction.** `.replit` specified `autoscale`; the
`.railway.toml` comment states that a host which suspends the process silently
stops scanning. The advisory locks and the `setInterval` scan loop assume one
long-lived process. `.replit` now says `vm`.

## What each commit does

| Commit | Patch | Change |
|---|---|---|
| 1 | P1, P3 | `.replit` → persistent VM. `health.ts` reports `LIVE`/`MONITOR`. |
| 2 | P6 | Adds `lib/reconcile.ts` — read-only settlement verification. |
| 3 | P2 | Adds `lib/tradingMode.ts` — boot-time gate. Corrects `app.ts`. |
| 4 | P2 | Wires the gate into `index.ts` before the port binds. |
| 5 | P4 | Keyed market-data tiers with keyless fallback. |
| 6 | P5 | Documents the conditions index honestly. No behaviour change. |
| 7 | P7 | Sizing ceiling agreement; MICRO risk 10% → 3%. |

## What this branch deliberately does not do

- **No strategy changes.** No threshold moved, no filter removed. The
  thresholds are hand-tuned and unvalidated; tuning them against recent
  results without a measured sample is how a strategy gets fitted to noise.
  Those files now say so in comments.
- **No `confidenceScore` rename.** The value is a market-conditions index, not
  a probability of profit, and that is now documented at the field, the engine
  and the schema consumer. Renaming the stored column would ripple through the
  DB, the OpenAPI spec and the frontend for no functional gain.
- **No reconciliation trigger hook in `tradeExecutor`.** `reconcilePendingPositions`
  is exported and reachable over `POST /trader/reconcile`, and `monitorPositions`
  is the intended caller, but `tradeExecutor.ts` itself is unchanged here. Wire
  the call from the monitor loop once the branch typechecks.
- **No live trading.** Ever, in this branch.

## Verifying the branch did not arm anything

After deploying from this branch, this must hold:

```
GET /api/health
→ { "status": "ok", "mode": "MONITOR", "entriesEnabled": false, "exitsEnabled": false }

GET /api/trader/trading-status
→ { "newTradesEnabled": false, "closesEnabled": false, "newTradeReason": "..." }
```

If `mode` reads `LIVE` on a deployment you did not intend to arm, the process
started with trading flags set. That is the case patch P2 turns into a startup
failure rather than a silent condition.
