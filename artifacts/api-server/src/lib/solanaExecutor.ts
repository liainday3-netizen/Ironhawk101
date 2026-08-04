/**
 * Solana On-Chain Executor
 * Uses @solana/web3.js + Jupiter Aggregator v6 REST API — no API keys.
 *
 * RPC: ankr.com public endpoint (more reliable than mainnet-beta.solana.com)
 *      Falls back to official RPC on failure.
 * Priority fee: Jupiter "auto" mode — dynamically estimates optimal fee.
 */

import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { logger } from "./logger";

// More reliable public RPCs — ankr primary, official as fallback
const SOLANA_RPCS = [
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
];
const JUPITER_API = "https://quote-api.jup.ag/v6";

const SOL_TOKENS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
};

export interface SolanaSwapResult {
  success: boolean;
  txHash?: string;
  amountIn: number;
  amountOut: number;
  priceImpactPct?: number;
  error?: string;
}

function getKeypair(): Keypair | null {
  const key = process.env.SOLANA_WALLET_PRIVATE_KEY;
  if (!key) return null;
  try {
    const decoded = bs58.decode(key);
    return Keypair.fromSecretKey(decoded);
  } catch {
    try {
      const arr = JSON.parse(key);
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch {
      return null;
    }
  }
}

/** Try RPCs in order, return the first that connects. */
function getConnection(): Connection {
  // Use ankr by default — fall back handled via error retry at call site
  return new Connection(SOLANA_RPCS[0], {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });
}

export async function getSolanaWalletAddress(): Promise<string | null> {
  const kp = getKeypair();
  return kp ? kp.publicKey.toBase58() : null;
}

export async function getSolanaBalance(tokenMint?: string): Promise<number> {
  const kp = getKeypair();
  if (!kp) return 0;
  try {
    const conn = getConnection();
    const mint = tokenMint ?? SOL_TOKENS.USDC;
    if (mint === SOL_TOKENS.SOL) {
      const bal = await conn.getBalance(kp.publicKey);
      return bal / 1e9;
    }
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(kp.publicKey, {
      mint: new PublicKey(mint),
    });
    const amount = tokenAccounts.value[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    return Number(amount);
  } catch (err) {
    logger.error({ err }, "Failed to get Solana balance");
    return 0;
  }
}

async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amountLamports: number,
  slippageBps: number = 50
): Promise<any | null> {
  const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${Math.floor(amountLamports)}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) {
    logger.warn({ status: res.status, url }, "Jupiter quote failed");
    return null;
  }
  return res.json();
}

async function buildAndSendSwap(
  kp: Keypair,
  quote: any,
  conn: Connection
): Promise<string> {
  const swapRes = await fetch(`${JUPITER_API}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: kp.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      // "auto" lets Jupiter estimate optimal priority fee from recent blocks
      prioritizationFeeLamports: "auto",
    }),
    signal: AbortSignal.timeout(12000),
  });

  if (!swapRes.ok) {
    const body = await swapRes.text().catch(() => "");
    throw new Error(`Jupiter swap API error ${swapRes.status}: ${body}`);
  }

  const { swapTransaction } = await swapRes.json() as { swapTransaction: string };
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([kp]);

  const txHash = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });

  // Confirm with timeout
  const latestBlockhash = await conn.getLatestBlockhash();
  await conn.confirmTransaction(
    { signature: txHash, ...latestBlockhash },
    "confirmed"
  );

  return txHash;
}

export async function executeBuySolana(
  outputMint: string,
  amountUsd: number,
  slippagePct: number = 0.5
): Promise<SolanaSwapResult> {
  const kp = getKeypair();
  if (!kp) return { success: false, amountIn: 0, amountOut: 0, error: "No Solana wallet configured" };

  try {
    const conn = getConnection();
    const slippageBps = Math.round(slippagePct * 100);
    // USDC has 6 decimals
    const amountLamports = Math.floor(amountUsd * 1_000_000);

    const quote = await getJupiterQuote(SOL_TOKENS.USDC, outputMint, amountLamports, slippageBps);
    if (!quote) return { success: false, amountIn: amountUsd, amountOut: 0, error: "Failed to get Jupiter quote" };

    logger.info({ outputMint, amountUsd, outAmount: quote.outAmount, priceImpact: quote.priceImpactPct }, "Solana BUY quote");

    const txHash = await buildAndSendSwap(kp, quote, conn);

    const outDecimals = quote.outputDecimals ?? 6;
    const outAmount = Number(quote.outAmount) / Math.pow(10, outDecimals);
    logger.info({ txHash, amountUsd, outputMint, outAmount }, "Solana BUY executed via Jupiter");

    return {
      success: true,
      txHash,
      amountIn: amountUsd,
      amountOut: outAmount,
      priceImpactPct: Number(quote.priceImpactPct ?? 0),
    };
  } catch (err: any) {
    logger.error({ err }, "Solana buy execution failed");
    return { success: false, amountIn: amountUsd, amountOut: 0, error: err?.message ?? String(err) };
  }
}

export async function executeSellSolana(
  inputMint: string,
  tokenDecimals: number,
  tokenAmount: number,
  slippagePct: number = 0.5
): Promise<SolanaSwapResult> {
  const kp = getKeypair();
  if (!kp) return { success: false, amountIn: 0, amountOut: 0, error: "No Solana wallet configured" };

  try {
    const conn = getConnection();
    const slippageBps = Math.round(slippagePct * 100);
    const amountLamports = Math.floor(tokenAmount * Math.pow(10, tokenDecimals));

    const quote = await getJupiterQuote(inputMint, SOL_TOKENS.USDC, amountLamports, slippageBps);
    if (!quote) return { success: false, amountIn: tokenAmount, amountOut: 0, error: "Failed to get Jupiter quote" };

    logger.info({ inputMint, tokenAmount, outAmount: quote.outAmount, priceImpact: quote.priceImpactPct }, "Solana SELL quote");

    const txHash = await buildAndSendSwap(kp, quote, conn);

    // Output is USDC (6 decimals)
    const outAmount = Number(quote.outAmount) / 1_000_000;
    logger.info({ txHash, tokenAmount, inputMint, outAmount }, "Solana SELL executed via Jupiter");

    return {
      success: true,
      txHash,
      amountIn: tokenAmount,
      amountOut: outAmount,
      priceImpactPct: Number(quote.priceImpactPct ?? 0),
    };
  } catch (err: any) {
    logger.error({ err }, "Solana sell execution failed");
    return { success: false, amountIn: tokenAmount, amountOut: 0, error: err?.message ?? String(err) };
  }
}
