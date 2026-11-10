import { Router } from "express";
import { isTradingEnabled, areTradingClosesEnabled } from "../lib/tradingGuard";

const router = Router();

/**
 * Public deployment probe. Deliberately unauthenticated, so it reports
 * whether trading is armed but never any data about positions, capital or
 * signals.
 */
router.get("/health", (_req, res) => {
  const entriesEnabled = isTradingEnabled();
  const exitsEnabled = areTradingClosesEnabled();
  res.json({
    status: "ok",
    // MONITOR until TRADING_ENABLED=true and a non-empty owner allowlist are
    // both configured. A running instance in MONITOR scans and records
    // signals but places no orders.
    mode: entriesEnabled ? "LIVE" : "MONITOR",
    entriesEnabled,
    exitsEnabled,
  });
});

export default router;
