import { Router } from "express";
import { searchDexPairs, getTrendingPairs, getOHLCV } from "../lib/marketData";

const router = Router();

// GET /market/search?q=&chain=
router.get("/market/search", async (req, res) => {
  const q = String(req.query.q ?? "");
  const chain = String(req.query.chain ?? "all");
  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }
  const pairs = await searchDexPairs(q, chain);
  res.json(pairs);
});

// GET /market/trending?chain=
router.get("/market/trending", async (req, res) => {
  const chain = String(req.query.chain ?? "ethereum");
  const pairs = await getTrendingPairs(chain);
  res.json(pairs);
});

// GET /market/candles?pairAddress=&chain=&timeframe=
router.get("/market/candles", async (req, res) => {
  const pairAddress = String(req.query.pairAddress ?? "");
  const chain = String(req.query.chain ?? "ethereum");
  const timeframe = String(req.query.timeframe ?? "1h");
  if (!pairAddress) {
    res.status(400).json({ error: "pairAddress is required" });
    return;
  }
  const candles = await getOHLCV(pairAddress, chain, timeframe);
  res.json(candles);
});

export default router;
