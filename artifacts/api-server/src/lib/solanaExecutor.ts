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
  amountOutRaw?: string;
  outputDecimals?: number;
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

export async function getSolanaTokenDecimals(tokenMint: string): Promise<number | null> {
  try {
    const conn = getConnection();
    const supply = await conn.getTokenSupply(new PublicKey(tokenMint));
    return supply.value.decimals;
  } catch (err) {
    logger.error({ err, tokenMint }, "Failed to read Solana token decimals");
    return null;
  }
}

async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amountRaw: string,
  slippageBps: number = 50
): Promise<any | null> {
  const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${encodeURIComponent(amountRaw)}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
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

  const swapResponse = await swapRes.json() as {
    swapTransaction?: string;
    lastValidBlockHeight?: number;
  };
  if (!swapResponse.swapTransaction || !Number.isSafeInteger(swapResponse.lastValidBlockHeight)) {
    throw new Error("Jupiter swap response is missing transaction expiry information");
  }
  const swapTransaction = swapResponse.swapTransaction;
  const lastValidBlockHeight = swapResponse.lastValidBlockHeight as number;
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  const recentBlockhash = tx.message.recentBlockhash;
  tx.sign([kp]);

  const txHash = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });

  // The blockhash and expiry must be those used to build this exact transaction.
  try {
    const confirmation = await conn.confirmTransaction(
      { signature: txHash, blockhash: recentBlockhash, lastValidBlockHeight },
      "confirmed"
    );
    if (confirmation.value.err) {
      throw new Error(`Solana transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
  } catch (err) {
    throw new SubmittedSwapError(
      err instanceof Error ? err.message : "Transaction confirmation failed",
      txHash,
    );
  }

  return txHash;
}

function validMint(mint: string): boolean {
  try {
    new PublicKey(mint);
    return true;
  } catch {
    return false;
  }
}

function validSlippage(slippagePct: number): boolean {
  return Number.isFinite(slippagePct) && slippagePct > 0 && slippagePct <= 2;
}

class SubmittedSwapError extends Error {
  constructor(message: string, readonly signature: string) {
    super(message);
    this.name = "SubmittedSwapError";
  }
}

function validRawAmount(amount: string): boolean {
  return /^[0-9]+$/.test(amount) && BigInt(amount) > 0n;
}

function decimalAmountToRaw(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("Invalid token amount or decimals");
  }
  const text = amount.toString().toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const point = whole.length + exponent + decimals;
  if (!Number.isInteger(point) || point < 0) throw new Error("Token amount is below token precision");
  const raw = point >= digits.length
    ? `${digits}${"0".repeat(point - digits.length)}`
    : digits.slice(0, point);
  if (point < digits.length && /[1-9]/.test(digits.slice(point))) {
    throw new Error("Token amount has more precision than the token supports");
  }
  const normalized = raw.replace(/^0+(?=\d)/, "");
  if (!validRawAmount(normalized)) throw new Error("Token amount must be greater than zero");
  return normalized;
}

async function getWalletTokenRawBalance(conn: Connection, owner: PublicKey, mint: string): Promise<bigint> {
  const accounts = await conn.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(mint) });
  return accounts.value.reduce((total, account) => {
    const raw = account.account.data.parsed?.info?.tokenAmount?.amount;
    return raw && /^[0-9]+$/.test(raw) ? total + BigInt(raw) : total;
  }, 0n);
}

function quoteAmount(quote: any, inputMint: string, outputMint: string, amountRaw: string): string {
  if (quote.inputMint !== inputMint || quote.outputMint !== outputMint) {
    throw new Error("Jupiter quote mints do not match requested swap");
  }
  if (quote.inAmount !== amountRaw || !validRawAmount(String(quote.outAmount ?? ""))) {
    throw new Error("Jupiter quote amounts are invalid");
  }
  return String(quote.outAmount);
}

export async function executeBuySolana(
  outputMint: string,
  amountUsd: number,
  slippagePct: number = 0.5
): Promise<SolanaSwapResult> {
  const kp = getKeypair();
  if (!kp) return { success: false, amountIn: 0, amountOut: 0, error: "No Solana wallet configured" };

  let submittedSignature: string | undefined;
  try {
    const conn = getConnection();
    if (!validMint(outputMint) || outputMint === SOL_TOKENS.USDC) {
      throw new Error("Invalid or unchanged buy token mint");
    }
    if (!validSlippage(slippagePct) || !Number.isFinite(amountUsd) || amountUsd <= 0 ||
        amountUsd > Number.MAX_SAFE_INTEGER / 1_000_000) {
      throw new Error("Invalid buy amount or slippage");
    }
    const outputDecimals = await getSolanaTokenDecimals(outputMint);
    if (outputDecimals === null || !Number.isInteger(outputDecimals) || outputDecimals < 0 || outputDecimals > 18) {
      throw new Error("Unable to verify buy token decimals");
    }
    const slippageBps = Math.round(slippagePct * 100);
    // USDC has 6 decimals
    const amountRaw = decimalAmountToRaw(amountUsd, 6);
    const walletInputBalance = await getWalletTokenRawBalance(conn, kp.publicKey, SOL_TOKENS.USDC);
    if (walletInputBalance < BigInt(amountRaw)) {
      throw new Error("Insufficient USDC balance for buy");
    }

    const quote = await getJupiterQuote(SOL_TOKENS.USDC, outputMint, amountRaw, slippageBps);
    if (!quote) return { success: false, amountIn: amountUsd, amountOut: 0, error: "Failed to get Jupiter quote" };
    quoteAmount(quote, SOL_TOKENS.USDC, outputMint, amountRaw);

    logger.info({ outputMint, amountUsd, outAmount: quote.outAmount, priceImpact: quote.priceImpactPct }, "Solana BUY quote");

    const outputBefore = await getWalletTokenRawBalance(conn, kp.publicKey, outputMint);
    const txHash = await buildAndSendSwap(kp, quote, conn);
    submittedSignature = txHash;

    const outputAfter = await getWalletTokenRawBalance(conn, kp.publicKey, outputMint);
    const outputRaw = outputAfter >= outputBefore ? outputAfter - outputBefore : 0n;
    const outAmount = Number(outputRaw) / Math.pow(10, outputDecimals);
    const success = outputRaw > 0n && Number.isFinite(outAmount);
    logger.info({ txHash, amountUsd, outputMint, outAmount }, "Solana BUY executed via Jupiter");

    return {
      success,
      txHash,
      amountIn: amountUsd,
      amountOut: outAmount,
      amountOutRaw: outputRaw.toString(),
      outputDecimals,
      priceImpactPct: Number(quote.priceImpactPct ?? 0),
      error: success ? undefined : "Confirmed swap produced no verifiable wallet token balance increase",
    };
  } catch (err: any) {
    logger.error({ err }, "Solana buy execution failed");
    return {
      success: false,
      txHash: submittedSignature ?? (err instanceof SubmittedSwapError ? err.signature : undefined),
      amountIn: amountUsd,
      amountOut: 0,
      error: err?.message ?? String(err),
    };
  }
}

export async function executeSellSolana(
  inputMint: string,
  tokenDecimals: number,
  tokenAmount: number,
  amountRaw?: string
): Promise<SolanaSwapResult> {
  const kp = getKeypair();
  if (!kp) return { success: false, amountIn: 0, amountOut: 0, error: "No Solana wallet configured" };

  let submittedSignature: string | undefined;
  try {
    const conn = getConnection();
    if (!validMint(inputMint) || inputMint === SOL_TOKENS.USDC || !Number.isInteger(tokenDecimals) ||
        tokenDecimals < 0 || tokenDecimals > 18 || !Number.isFinite(tokenAmount) || tokenAmount <= 0 ||
        tokenAmount > Number.MAX_SAFE_INTEGER) {
      throw new Error("Invalid sell mint, amount, or token decimals");
    }
    const verifiedDecimals = await getSolanaTokenDecimals(inputMint);
    if (verifiedDecimals === null || verifiedDecimals !== tokenDecimals) {
      throw new Error("Provided token decimals do not match the mint");
    }
    const rawAmount = amountRaw ?? decimalAmountToRaw(tokenAmount, tokenDecimals);
    if (!validRawAmount(rawAmount)) throw new Error("Invalid raw sell amount");
    const slippagePct = 0.5;
    const slippageBps = Math.round(slippagePct * 100);
    const walletInputBalance = await getWalletTokenRawBalance(conn, kp.publicKey, inputMint);
    if (walletInputBalance < BigInt(rawAmount)) {
      throw new Error("Insufficient token balance for sell");
    }

    const quote = await getJupiterQuote(inputMint, SOL_TOKENS.USDC, rawAmount, slippageBps);
    if (!quote) return { success: false, amountIn: tokenAmount, amountOut: 0, error: "Failed to get Jupiter quote" };
    quoteAmount(quote, inputMint, SOL_TOKENS.USDC, rawAmount);

    logger.info({ inputMint, tokenAmount, outAmount: quote.outAmount, priceImpact: quote.priceImpactPct }, "Solana SELL quote");

    const outputDecimals = await getSolanaTokenDecimals(SOL_TOKENS.USDC);
    if (outputDecimals === null || outputDecimals !== 6) throw new Error("Unable to verify USDC decimals");
    const outputBefore = await getWalletTokenRawBalance(conn, kp.publicKey, SOL_TOKENS.USDC);
    const txHash = await buildAndSendSwap(kp, quote, conn);
    submittedSignature = txHash;

    const outputAfter = await getWalletTokenRawBalance(conn, kp.publicKey, SOL_TOKENS.USDC);
    const outputRaw = outputAfter >= outputBefore ? outputAfter - outputBefore : 0n;
    const outAmount = Number(outputRaw) / Math.pow(10, outputDecimals);
    const success = outputRaw > 0n && Number.isFinite(outAmount);
    logger.info({ txHash, tokenAmount, inputMint, outAmount }, "Solana SELL executed via Jupiter");

    return {
      success,
      txHash,
      amountIn: tokenAmount,
      amountOut: outAmount,
      amountOutRaw: outputRaw.toString(),
      outputDecimals,
      priceImpactPct: Number(quote.priceImpactPct ?? 0),
      error: success ? undefined : "Confirmed swap produced no verifiable wallet USDC balance increase",
    };
  } catch (err: any) {
    logger.error({ err }, "Solana sell execution failed");
    return {
      success: false,
      txHash: submittedSignature ?? (err instanceof SubmittedSwapError ? err.signature : undefined),
      amountIn: tokenAmount,
      amountOut: 0,
      error: err?.message ?? String(err),
    };
  }
}
