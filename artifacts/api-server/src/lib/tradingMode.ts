import { getTradingConfigurationError, getCloseTradingConfigurationError } from "./lib/tradingGuard";
import { logger } from "./lib/logger";

/**
 * Trading mode gate, evaluated once at boot.
 *
 * WHY THIS EXISTS
 * ───────────────
 * tradingGuard already refuses every individual trade when the environment is
 * incomplete, so a misconfigured process cannot place an order — that part was
 * always correct. What was missing is that it could still *start*, quietly, in
 * a configuration nobody intended, and scan away all night while the operator
 * assumed it was live. Silent divergence between intent and state is the
 * failure this closes.
 *
 * Two behaviours:
 *   - A partial live configuration (any trading flag set without the rest) is
 *     a hard startup failure. Better to crash in the deploy log than to run.
 *   - A complete live configuration logs a loud, unmissable warning.
 *   - Everything else is monitor mode: scan, record, refuse to trade.
 */
export type TradingMode = "LIVE" | "MONITOR";

export interface TradingSession {
  mode: TradingMode;
  entriesEnabled: boolean;
  exitsEnabled: boolean;
}

function flagIsOn(value: string | undefined): boolean {
  return value === "true";
}

export function beginTradingSession(): TradingSession {
  const entriesRaw = process.env.TRADING_ENABLED;
  const exitsRaw = process.env.TRADING_CLOSES_ENABLED;
  const entriesOn = flagIsOn(entriesRaw);
  const exitsOn = flagIsOn(exitsRaw);

  const entriesError = entriesOn ? getTradingConfigurationError() : null;
  const exitsError = exitsOn ? getCloseTradingConfigurationError() : null;

  if (entriesError || exitsError) {
    logger.fatal(
      {
        TRADING_ENABLED: entriesRaw ?? "(unset)",
        TRADING_CLOSES_ENABLED: exitsRaw ?? "(unset)",
        entriesError,
        exitsError,
      },
      "Refusing to start: a trading flag is set but its configuration is incomplete. " +
        "Either finish the configuration or unset the flag to run in monitor mode.",
    );
    process.exit(1);
  }

  const session: TradingSession = {
    mode: entriesOn && exitsOn ? "LIVE" : entriesOn ? "LIVE" : "MONITOR",
    entriesEnabled: entriesOn,
    exitsEnabled: exitsOn,
  };

  if (session.mode === "LIVE") {
    logger.warn(
      session,
      "STARTING WITH LIVE TRADING ARMED — this process can place real orders. " +
        "Verify wallet, thresholds and maximum position size before continuing.",
    );
  } else {
    logger.info(
      session,
      "Starting in MONITOR mode: the scanner will observe and record signals, " +
        "and every trade will be refused. No orders will be placed.",
    );
  }

  return session;
}
