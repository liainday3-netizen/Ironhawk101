const LIVE_TRADING_ENABLED = "true";
const LIVE_CLOSES_ENABLED = "true";

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

export function getTradingConfigurationError(): string | null {
  const ownerError = getOwnerAllowlistError();
  if (ownerError) return ownerError;
  if (process.env.TRADING_ENABLED !== LIVE_TRADING_ENABLED) {
    return "New live trades are disabled until TRADING_ENABLED=true is configured";
  }
  if (process.env.TRADING_CLOSES_ENABLED !== LIVE_CLOSES_ENABLED) {
    return "New live trades are disabled until TRADING_CLOSES_ENABLED=true is configured for exits";
  }
  return null;
}

export function getCloseTradingConfigurationError(): string | null {
  const ownerError = getOwnerAllowlistError();
  if (ownerError) return ownerError;
  if (process.env.TRADING_CLOSES_ENABLED !== LIVE_CLOSES_ENABLED) {
    return "On-chain exits are disabled until TRADING_CLOSES_ENABLED=true is configured";
  }
  return null;
}

export function isTradingEnabled(): boolean {
  return getTradingConfigurationError() === null;
}

export function areTradingClosesEnabled(): boolean {
  return getCloseTradingConfigurationError() === null;
}