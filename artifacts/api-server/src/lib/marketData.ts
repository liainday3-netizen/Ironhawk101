/**
 * Market data fetcher using DexScreener and GeckoTerminal public APIs.
 *
 * Both are keyless by default, which is fine for development and for a single
 * low-frequency scanner. Under a 30-second cycle across many pairs it is not:
 * the public tiers rate-limit, and a rate-limited fetch looks identical to a
 * pair with no data, so the engine degrades by silently producing no signals
 * rather than by raising an error anyone would see.
 *
 * Set DEXSCREENER_API_KEY and/or GECKOTERMINAL_API_KEY to use the keyed tiers.
 * The headers are omitted entirely when a key is absent, so behaviour without
 * keys is exactly as before.
 */

export interface OHLCVCandle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DexPair {
  pairAddress: string;
  symbol: string;
  baseToken: string;           // symbol, e.g. "WETH"
  baseTokenAddress: string;    // contract address
  quoteToken: string;
  chain: string;
  dex: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  txns24h: number;
}

// DexScreener chain IDs
const CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  solana: "solana",
};

// GeckoTerminal network IDs
const GECKO_NETWORK_MAP: Record<string, string> = {
  ethereum: "eth",
  base: "base",
  solana: "solana",
};

// GeckoTerminal timeframe map
const GECKO_TIMEFRAME_MAP: Record<string, { aggregate: string; period: string }> = {
  "1m": { aggregate: "minute", period: "1" },
  "5m": { aggregate: "minute", period: "5" },
  "15m": { aggregate: "minute", period: "15" },
  "1h": { aggregate: "hour", period: "1" },
  "4h": { aggregate: "hour", period: "4" },
  "1d": { aggregate: "day", period: "1" },
};

function geckoHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json;version=20230302",
  };
  if (process.env.GECKOTERMINAL_API_KEY) {
    headers["x-cg-demo-api-key"] = process.env.GECKOTERMINAL_API_KEY;
  }
  return headers;
}

function dexScreenerHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.DEXSCREENER_API_KEY) {
    headers["X-API-KEY"] = process.env.DEXSCREENER_API_KEY;
  }
  return headers;
}

function parseDexScreenerPair(p: any, chain: string): DexPair {
  return {
    pairAddress: p.pairAddress ?? "",
    symbol: `${p.baseToken?.symbol ?? ""}/${p.quoteToken?.symbol ?? ""}`,
    baseToken: p.baseToken?.symbol ?? "",
    baseTokenAddress: p.baseToken?.address ?? "",
    quoteToken: p.quoteToken?.symbol ?? "",
    chain: chain || (CHAIN_MAP[p.chainId] ? p.chainId : "ethereum"),
    dex: p.dexId ?? "",
    price: parseFloat(p.priceUsd ?? "0") || 0,
    priceChange24h: p.priceChange?.h24 ?? 0,
    volume24h: p.volume?.h24 ?? 0,
    liquidity: p.liquidity?.usd ?? 0,
    txns24h: (p.txns?.h24?.buys ?? 0) + (p.txns?.h24?.sells ?? 0),
  };
}

export async function searchDexPairs(q: string, chain: string = "all"): Promise<DexPair[]> {
  const url = `https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: dexScreenerHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { pairs?: unknown[] };
  const pairs: unknown[] = data.pairs ?? [];
  return (pairs as any[])
    .filter((p) => chain === "all" || p.chainId === CHAIN_MAP[chain])
    .slice(0, 30)
    .map((p) => parseDexScreenerPair(p, p.chainId));
}

export async function getTrendingPairs(chain: string = "ethereum"): Promise<DexPair[]> {
  const geckoNetwork = GECKO_NETWORK_MAP[chain] ?? "eth";
  const url = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/trending_pools?page=1`;
  const res = await fetch(url, {
    headers: geckoHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    return searchDexPairs("weth usdc", chain);
  }
  const data = (await res.json()) as { data?: any[] };
  const pools: any[] = data.data ?? [];
  return pools.slice(0, 20).map((p: any) => {
    const attr = p.attributes ?? {};
    return {
      pairAddress: attr.address ?? p.id ?? "",
      symbol: attr.name ?? "",
      baseToken: attr.name?.split(" / ")?.[0] ?? "",
      baseTokenAddress: "",
      quoteToken: attr.name?.split(" / ")?.[1] ?? "USD",
      chain,
      dex: attr.dex_id ?? "",
      price: parseFloat(attr.base_token_price_usd ?? "0") || 0,
      priceChange24h: parseFloat(attr.price_change_percentage?.h24 ?? "0") || 0,
      volume24h: parseFloat(attr.volume_usd?.h24 ?? "0") || 0,
      liquidity: parseFloat(attr.reserve_in_usd ?? "0") || 0,
      txns24h: (attr.transactions?.h24?.buys ?? 0) + (attr.transactions?.h24?.sells ?? 0),
    };
  });
}

export async function getPairInfo(pairAddress: string, chain: string): Promise<DexPair | null> {
  const chainId = CHAIN_MAP[chain] ?? chain;
  const url = `https://api.dexscreener.com/latest/dex/pairs/${chainId}/${pairAddress}`;
  const res = await fetch(url, {
    headers: dexScreenerHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { pair?: any; pairs?: any[] };
  const pair = data.pair ?? data.pairs?.[0];
  if (!pair) return null;
  return parseDexScreenerPair(pair, chain);
}

export async function getOHLCV(
  pairAddress: string,
  chain: string,
  timeframe: string = "1h"
): Promise<OHLCVCandle[]> {
  const geckoNetwork = GECKO_NETWORK_MAP[chain] ?? "eth";
  const tf = GECKO_TIMEFRAME_MAP[timeframe] ?? { aggregate: "hour", period: "1" };
  const url = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/pools/${pairAddress}/ohlcv/${tf.aggregate}?aggregate=${tf.period}&limit=200&currency=usd&token=base`;

  const res = await fetch(url, {
    headers: geckoHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: { attributes?: { ohlcv_list?: any[][] } } };
  const ohlcvList: any[][] = data.data?.attributes?.ohlcv_list ?? [];
  return ohlcvList
    .map(([t, o, h, l, c, v]) => ({
      time: Math.floor(t / 1000),
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: Number(v),
    }))
    .reverse();
}
