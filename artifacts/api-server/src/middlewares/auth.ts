import { getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

function allowedTradingUsers(): Set<string> {
  return new Set(
    (process.env.TRADING_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
};

export const requireTradingAccess: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const allowedUsers = allowedTradingUsers();
  if (allowedUsers.size === 0) {
    res.status(503).json({
      error:
        "Trading controls are disabled until TRADING_ALLOWED_USER_IDS is configured",
    });
    return;
  }

  if (!allowedUsers.has(userId)) {
    res.status(403).json({ error: "Trading access denied" });
    return;
  }

  next();
};