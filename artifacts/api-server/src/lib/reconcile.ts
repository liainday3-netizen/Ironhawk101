import { pool } from "@workspace/db";
import { createWalletClient, createPublicClient, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, base } from "viem/chains";
import { Connection, PublicKey, type Keypair } from "@solana/web3.js";
import { logger } from "./logger";

/**
 * Settlement verification.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The executor broadcasts an entry, then decides whether to mark the position
 * OPEN based on the swap result. When the broadcast succeeds but the *result*
 * cannot be verified (an RPC read failed, a receipt was unavailable, the
 * process moved on), the position is correctly flagged RECONCILIATION_REQUIRED
 * rather than OPEN — a blind retry over an unconfirmed swap is the dangerous
 * alternative.
 *
 * The gap this module closes: nothing ever resolved those rows. The flag
 * prevented a bad retry, but the position sat in limbo forever, so real
 * on-chain exposure was invisible to the P&L and to the position count.
 *
 * Every function here is READ-ONLY. Reconciliation only ever does two things:
 * promote a position that provably settled, or mark one that provably failed.
 * Anything else is left alone and logged for a human — there is no third
 * outcome where this module places a trade.
 */

const RPC_URLS: Record<string, string> = {
  ethereum: process.env.ETHEREUM_RPC_URL ?? "https://ethereum.publicnode.com",
  base: process.env.BASE_RPC_URL ?? "https://base.publicnode.com",
};

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? "https://rpc.ankr.com/solana";

const ERC20_ABI = [
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

/**
 * `settled` — the chain says the transaction landed. `failed` — the chain says
 * it did not. `unknown` — we could not find out, which is NOT a failure and
 * must never be treated as one.
 */
export type Settlement = "settled" | "failed" | "unknown";

export interface ReconciliationResult {
  /** Rows found awaiting reconciliation. */
  examined: number;
  /** Rows promoted to OPEN because the entry provably succeeded. */
  promoted: number;
  /** Rows marked FAILED because the entry provably did not succeed. */
  failed: number;
  /** Rows deliberately left alone, with the reason. */
  deferred: Array<{ positionId: number; reason: string }>;
}

export interface OnChainEntry {
  txHash: string;
  settled: Settlement;
  /**
   * Exact received amount, when it could be proven. `null` means the transfer
   * could not be accounted for, so the position stays unresolved rather than
   * being promoted on a guess.
   */
  amountOutRaw: string | null;
  amountOut: number;
  outputDecimals: number | null;
  error?: string;
}

function getEvmPrivateKey(chain: string): `0x${string}` | null {
  const raw = chain === "base"
    ? (process.env.BASE_WALLET_PRIVATE_KEY || process.env.EVM_WALLET_PRIVATE_KEY)
    : process.env.EVM_WALLET_PRIVATE_KEY;
  if (!raw) return null;
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

/**
 * Confirm an EVM entry by receipt status, then account for the output token by
 * reading the wallet's own balance rather than parsing logs.
 *
 * A balance read is the more conservative check: it answers "what does the
 * wallet hold now", which is the only figure that matters for exposure. Log
 * parsing can be defeated by proxy contracts, non-standard Transfer events and
 * fee-on-transfer tokens in ways a balance read cannot.
 */
export async function verifyEvmEntry(
  chain: string,
  txHash: string,
  tokenAddress: string,
  knownDecimals: number | null,
): Promise<OnChainEntry> {
  const result: OnChainEntry = {
    txHash,
    settled: "unknown",
    amountOutRaw: null,
    amountOut: 0,
    outputDecimals: knownDecimals,
  };

  if (!["ethereum", "base"].includes(chain)) {
    return { ...result, error: `Unsupported reconciliation chain: ${chain}` };
  }
  const rpc = RPC_URLS[chain];
  const key = getEvmPrivateKey(chain);
  if (!key) return { ...result, error: "No EVM private key configured" };
  if (!isAddress(tokenAddress)) return { ...result, error: "Invalid token address" };
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) return { ...result, error: "Invalid transaction hash" };

  try {
    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({
      chain: chain === "base" ? base : mainnet,
      transport: http(rpc),
    });

    let receipt: { status: string } | null = null;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    } catch {
      // Not found is ambiguous: the tx may be pending, or dropped, or the RPC
      // may simply not have it. Never conclude failure from a missing receipt.
      return { ...result, error: "Receipt not available yet" };
    }

    if (receipt.status !== "success") {
      return { ...result, settled: "failed", error: "Entry transaction reverted on chain" };
    }

    const decimals = knownDecimals ?? Number(await publicClient.readContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: "decimals",
    }));
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      return { ...result, settled: "settled", error: "Cannot verify output decimals" };
    }

    const balance = await publicClient.readContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }) as bigint;

    const amountOutRaw = balance.toString();
    return {
      txHash,
      settled: "settled",
      amountOutRaw,
      amountOut: Number(amountOutRaw) / Math.pow(10, decimals),
      outputDecimals: decimals,
    };
  } catch (err) {
    logger.error({ err, chain, txHash }, "EVM entry verification failed");
    return { ...result, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Confirm a Solana entry by signature status, then measure the output token as
 * a balance delta against the pre-trade snapshot taken at execution time.
 *
 * Solana needs the snapshot because a wallet can already hold the token: the
 * current balance alone cannot distinguish "received 40 TOKEN from this trade"
 * from "held 40 TOKEN before it".
 */
export async function verifySolanaEntry(
  txHash: string,
  tokenMint: string,
  balanceBeforeRaw: string | null,
): Promise<OnChainEntry> {
  const result: OnChainEntry = {
    txHash,
    settled: "unknown",
    amountOutRaw: null,
    amountOut: 0,
    outputDecimals: null,
  };

  const raw = process.env.SOLANA_WALLET_PRIVATE_KEY;
  if (!raw) return { ...result, error: "No Solana private key configured" };
  if (!txHash || txHash.length < 32) return { ...result, error: "Invalid transaction signature" };

  try {
    const { Keypair } = await import("@solana/web3.js");
    const bs58 = (await import("bs58")).default;
    let keypair: Keypair | null = null;
    try {
      keypair = Keypair.fromSecretKey(bs58.decode(raw));
    } catch {
      try {
        keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
      } catch {
        keypair = null;
      }
    }
    if (!keypair) return { ...result, error: "Could not decode Solana private key" };

    const conn = new Connection(SOLANA_RPC_URL, { commitment: "confirmed" });

    let status: { err: unknown; confirmationStatus?: string } | null = null;
    try {
      const res = await conn.getSignatureStatuses([txHash]);
      status = res.value[0] ?? null;
    } catch {
      return { ...result, error: "Could not read signature status" };
    }

    if (!status) {
      // Absent from status is ambiguous (pending, dropped, or not yet indexed).
      return { ...result, error: "Signature not indexed yet" };
    }
    if (status.err) {
      return { ...result, settled: "failed", error: `Entry transaction failed: ${JSON.stringify(status.err)}` };
    }
    if (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized") {
      return { ...result, error: `Not yet confirmed (${status.confirmationStatus ?? "unknown"})` };
    }

    const accounts = await conn.getParsedTokenAccountsByOwner(keypair.publicKey, {
      mint: new PublicKey(tokenMint),
    });
    const balanceAfterRaw = accounts.value.reduce((total, account) => {
      const amount = account.account.data.parsed?.info?.tokenAmount?.amount;
      return amount && /^[0-9]+$/.test(amount) ? total + BigInt(amount) : total;
    }, 0n);

    const decimals = accounts.value[0]?.account?.data?.parsed?.info?.tokenAmount?.decimals;
    const outputDecimals = typeof decimals === "number" ? decimals : null;

    if (balanceBeforeRaw === null || !/^[0-9]+$/.test(balanceBeforeRaw)) {
      // Confirmed on chain, but with no snapshot we cannot state the size.
      return {
        ...result,
        settled: "settled",
        outputDecimals,
        error: "No pre-trade balance snapshot; size indeterminate",
      };
    }

    const before = BigInt(balanceBeforeRaw);
    const delta = balanceAfterRaw >= before ? balanceAfterRaw - before : 0n;
    return {
      txHash,
      settled: "settled",
      amountOutRaw: delta.toString(),
      amountOut: outputDecimals === null ? 0 : Number(delta) / Math.pow(10, outputDecimals),
      outputDecimals,
    };
  } catch (err) {
    logger.error({ err, txHash }, "Solana entry verification failed");
    return { ...result, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Count positions currently awaiting reconciliation. Read-only; useful for
 * health checks and for the performance summary.
 */
export async function countPendingReconciliation(): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM positions WHERE status = 'RECONCILIATION_REQUIRED'",
  );
  return Number(result.rows[0]?.count ?? 0);
}
