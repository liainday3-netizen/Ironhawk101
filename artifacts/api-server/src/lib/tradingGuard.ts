/**
 * Live-trading configuration guard.
 *
 * Fail-closed by design: every check below returns a non-null error string
 * unless the environment is explicitly and correctly configured. An unset
 * variable is treated exactly like a wrong one — there is no default that
 * permits trading.
 *
 * The two constants below are the VALUES the environment variables must
 * equal. They are not feature flags and setting them here does not enable
 * anything; trading is enabled only by the corresponding process.env entry
 * being present and equal to REQUIRED_ENABLE_VALUE in the deployed
 * environment.
 */

/** The literal string TRADING_ENABLED / TRADING_CLOSES_ENABLED must equal. */
const REQUIRED_ENABLE_VALUE = "true";

const TRADING_ENABLED_VAR = "TRADING_ENABLED";
const TRADING_CLOSES_ENABLED_VAR = "TRADING_CLOSES_ENABLED";

function getOwnerAllowlistError(): string | null {
  const allowedUsers = (process.env.TRADING_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedUsers.length === 0) {
    return "Live trading is disabled until TRADING_ALLOWED_USER_IDS is configured";
  }
  return null;
}

/**
 * Returns null when the environment permits new live trades, or a
 * human-readable reason it does not.
 */
export function getTradingConfigurationError(): string | null {
  const ownerError = getOwnerAllowlistError();
  if (ownerError) return ownerError;
  if (process.env[TRADING_ENABLED_VAR] !== REQUIRED_ENABLE_VALUE) {
    return `New live trades are disabled until ${TRADING_ENABLED_VAR}=${REQUIRED_ENABLE_VALUE} is configured`;
  }
  if (process.env[TRADING_CLOSES_ENABLED_VAR] !== REQUIRED_ENABLE_VALUE) {
    return `New live trades are disabled until ${TRADING_CLOSES_ENABLED_VAR}=${REQUIRED_ENABLE_VALUE} is configured for exits`;
  }
  return null;
}

/**
 * Exits are gated separately from entries so a position can always be
 * closed even when new entries are disabled — being unable to reduce risk
 * is a worse failure than being unable to add it.
 */
export function getCloseTradingConfigurationError(): string | null {
  const ownerError = getOwnerAllowlistError();
  if (ownerError) return ownerError;
  if (process.env[TRADING_CLOSES_ENABLED_VAR] !== REQUIRED_ENABLE_VALUE) {
    return `On-chain exits are disabled until ${TRADING_CLOSES_ENABLED_VAR}=${REQUIRED_ENABLE_VALUE} is configured`;
  }
  return null;
}

export function isTradingEnabled(): boolean {
  return getTradingConfigurationError() === null;
}

export function areTradingClosesEnabled(): boolean {
  return getCloseTradingConfigurationError() === null;
}
