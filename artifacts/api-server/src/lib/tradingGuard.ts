const LIVE_TRADING_ENABLED = "true";

export function getTradingConfigurationError(): string | null {
  if (process.env.TRADING_ENABLED !== LIVE_TRADING_ENABLED) {
    return "Live trading is disabled until TRADING_ENABLED=true is configured";
  }

  const allowedUsers = (process.env.TRADING_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (allowedUsers.length === 0) {
    return "Live trading is disabled until TRADING_ALLOWED_USER_IDS is configured";
  }

  return null;
}

export function isTradingEnabled(): boolean {
  return getTradingConfigurationError() === null;
}