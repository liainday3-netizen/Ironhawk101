/**
 * EVM On-Chain Executor (Ethereum + Base)
 * Uses viem + Uniswap V3 Universal Router — no API keys.
 * Public RPC endpoints: publicnode.com
 *
 * Real swap logic:
 * - QuoterV2 probes fee tiers [500, 3000, 10000] to find the live pool + quote
 * - amountOutMinimum is set from the quote with slippage applied
 * - Actual amountOut is parsed from the ERC-20 Transfer event on the output token
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  encodeAbiParameters,
  parseAbiParameters,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, base } from "viem/chains";
import { logger } from "./logger";

const RPC_URLS: Record<string, string> = {
  ethereum: "https://ethereum.publicnode.com",
  base: "https://base.publicnode.com",
};

// Uniswap V3 Universal Router (same address on Ethereum + Base)
const UNIVERSAL_ROUTER: Address = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// Uniswap V3 QuoterV2 — used to find the best fee tier and get a real quote
const QUOTER_V2: Record<string, Address> = {
  ethereum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  base: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
};

// ERC-20 Transfer event topic
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;

// Pool fee tiers to probe (bps)
const FEE_TIERS = [500, 3000, 10000] as const;

const TOKENS: Record<string, Record<string, Address>> = {
  ethereum: {
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },
  base: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
};

const ERC20_ABI = [
  { name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "balanceOf", type: "function", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "decimals", type: "function", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { name: "allowance", type: "function", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

const PERMIT2_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

const QUOTER_V2_ABI = [
  {
    name: "quoteExactInputSingle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export interface SwapResult {
  success: boolean;
  txHash?: string;
  amountIn: number;
  amountOut: number;
  amountOutRaw?: string;
  outputDecimals?: number;
  fee?: number;
  gasUsed?: number;
  error?: string;
}

function getChainConfig(chain: string) {
  if (chain === "base") return { viemChain: base, rpc: RPC_URLS.base };
  return { viemChain: mainnet, rpc: RPC_URLS.ethereum };
}

function getPrivateKey(chain: string): Hex | null {
  const key = chain === "base"
    ? (process.env.BASE_WALLET_PRIVATE_KEY || process.env.EVM_WALLET_PRIVATE_KEY)
    : process.env.EVM_WALLET_PRIVATE_KEY;
  if (!key) return null;
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
}

/**
 * Probe QuoterV2 across fee tiers to find the best pool and real output amount.
 * Returns { fee, amountOut } for the best tier, or null if no pool found.
 */
async function getBestQuote(
  chain: string,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
): Promise<{ fee: number; amountOut: bigint; outputDecimals: number } | null> {
  const { viemChain, rpc } = getChainConfig(chain);
  const quoter = QUOTER_V2[chain];
  if (!quoter || !isAddress(tokenIn) || !isAddress(tokenOut)) return null;

  const publicClient = createPublicClient({ chain: viemChain, transport: http(rpc) });

  // Decimals are part of the amount contract. Never guess if an RPC read fails.
  let outputDecimals: number;
  try {
    outputDecimals = Number(await publicClient.readContract({
      address: tokenOut, abi: ERC20_ABI, functionName: "decimals",
    }));
    if (!Number.isInteger(outputDecimals) || outputDecimals < 0 || outputDecimals > 18) {
      return null;
    }
  } catch {
    return null;
  }

  let bestFee = 0;
  let bestOut = 0n;

  for (const fee of FEE_TIERS) {
    try {
      const result = await publicClient.simulateContract({
        address: quoter,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      const amountOut = result.result[0] as bigint;
      if (amountOut > bestOut) {
        bestOut = amountOut;
        bestFee = fee;
      }
    } catch { /* pool not found at this fee tier */ }
  }

  if (bestFee === 0 || bestOut === 0n) return null;
  return { fee: bestFee, amountOut: bestOut, outputDecimals };
}

/**
 * Parse the actual received amount from an ERC-20 Transfer event.
 * Looks for Transfer(to=recipientAddress) on the output token in the tx receipt.
 */
function parseTransferAmountOutRaw(
  receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] },
  outputToken: Address,
  recipient: Address,
): string {
  const recipientPadded = `0x${recipient.toLowerCase().replace("0x", "").padStart(64, "0")}`;
  let total = 0n;
  for (const log of receipt.logs) {
    if (
      log.address.toLowerCase() === outputToken.toLowerCase() &&
      log.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
      log.topics[2]?.toLowerCase() === recipientPadded
    ) {
      try {
        total += BigInt(log.data);
      } catch { /* ignore parse error */ }
    }
  }
  return total.toString();
}

export async function getEvmTokenDecimals(
  chain: string,
  tokenAddress: string,
): Promise<number | null> {
  if (!RPC_URLS[chain] || !isAddress(tokenAddress)) return null;
  const { viemChain, rpc } = getChainConfig(chain);
  try {
    const decimals = Number(await createPublicClient({
      chain: viemChain,
      transport: http(rpc),
    }).readContract({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: "decimals",
    }));
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : null;
  } catch (err) {
    logger.error({ err, chain }, "Failed to verify EVM token decimals");
    return null;
  }
}

function getSlippageMultiplier(slippagePct: number): bigint {
  if (!Number.isFinite(slippagePct) || slippagePct <= 0 || slippagePct > 2) {
    throw new Error("Slippage must be greater than 0% and no more than 2%");
  }
  return BigInt(Math.floor((1 - slippagePct / 100) * 10_000));
}

async function ensureRouterAllowance(
  chain: string,
  account: any,
  walletClient: any,
  publicClient: any,
  token: Address,
  amount: bigint,
): Promise<void> {
  const erc20Allowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, PERMIT2],
  }) as bigint;

  // Approve only this trade amount, not an unlimited allowance.
  if (erc20Allowance < amount) {
    const approveTx = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PERMIT2, amount],
    });
    const approval = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    if (approval.status !== "success") throw new Error("ERC-20 approval transaction reverted");
  }

  const [permitAmount, expiration] = await publicClient.readContract({
    address: PERMIT2,
    abi: PERMIT2_ABI,
    functionName: "allowance",
    args: [account.address, token, UNIVERSAL_ROUTER],
  });
  const now = Math.floor(Date.now() / 1000);
  if (permitAmount < amount || expiration <= now) {
    const approveTx = await walletClient.writeContract({
      address: PERMIT2,
      abi: PERMIT2_ABI,
      functionName: "approve",
      args: [token, UNIVERSAL_ROUTER, amount, now + 600],
    });
    const approval = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    if (approval.status !== "success") throw new Error("Permit2 approval transaction reverted");
  }
  logger.info({ chain, token }, "Trade-limited router allowance ready");
}

export async function getWalletBalance(chain: string, tokenSymbol: string = "USDC"): Promise<number> {
  const { viemChain, rpc } = getChainConfig(chain);
  const key = getPrivateKey(chain);
  if (!key) return 0;

  try {
    const account = privateKeyToAccount(key);
    const client = createPublicClient({ chain: viemChain, transport: http(rpc) });
    const tokenAddress = TOKENS[chain]?.[tokenSymbol];
    if (!tokenAddress) return 0;

    const [balance, decimals] = await Promise.all([
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
      client.readContract({ address: tokenAddress, abi: ERC20_ABI, functionName: "decimals" }),
    ]);

    return Number(formatUnits(balance as bigint, decimals as number));
  } catch (err) {
    logger.error({ err, chain, tokenSymbol }, "Failed to get wallet balance");
    return 0;
  }
}

export async function getWalletAddress(chain: string): Promise<string | null> {
  const key = getPrivateKey(chain);
  if (!key) return null;
  try {
    return privateKeyToAccount(key).address;
  } catch {
    return null;
  }
}

export async function executeBuyEVM(
  chain: string,
  tokenAddress: Address,
  amountUsd: number,
  slippagePct: number = 0.5
): Promise<SwapResult> {
  const key = getPrivateKey(chain);
  if (!key) return { success: false, amountIn: 0, amountOut: 0, error: "No wallet private key configured" };
  if (
    !["ethereum", "base"].includes(chain) ||
    !isAddress(tokenAddress) ||
    !Number.isFinite(amountUsd) ||
    amountUsd <= 0 ||
    amountUsd > 1_000
  ) {
    return { success: false, amountIn: amountUsd, amountOut: 0, error: "Invalid EVM buy parameters" };
  }

  const { viemChain, rpc } = getChainConfig(chain);
  const usdcAddress = TOKENS[chain]?.["USDC"];
  if (!usdcAddress) return { success: false, amountIn: 0, amountOut: 0, error: `No USDC token for chain ${chain}` };

  let submittedTxHash: Hex | undefined;
  try {
    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: viemChain, transport: http(rpc) });
    const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpc) });

    const amountIn = parseUnits(amountUsd.toFixed(6), 6);
    const balance = await publicClient.readContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }) as bigint;
    if (balance < amountIn) {
      return { success: false, amountIn: amountUsd, amountOut: 0, error: "Insufficient USDC balance" };
    }

    // --- Quote: find best fee tier and compute slippage-protected minimum ---
    const quote = await getBestQuote(chain, usdcAddress, tokenAddress, amountIn);
    if (!quote) {
      return { success: false, amountIn: amountUsd, amountOut: 0, error: "No V3 pool found for this token on any fee tier" };
    }
    const slippageMultiplier = getSlippageMultiplier(slippagePct);
    const amountOutMinimum = (quote.amountOut * slippageMultiplier) / 10000n;
    if (amountOutMinimum <= 0n) {
      return { success: false, amountIn: amountUsd, amountOut: 0, error: "Quoted minimum output rounds to zero" };
    }

    logger.info({ chain, tokenAddress, fee: quote.fee, amountIn: amountUsd, amountOutRaw: quote.amountOut.toString() }, "EVM BUY quote");

    await ensureRouterAllowance(chain, account, walletClient, publicClient, usdcAddress, amountIn);

    // --- Execute swap via Universal Router V3_SWAP_EXACT_IN (command 0x00) ---
    const DEADLINE = BigInt(Math.floor(Date.now() / 1000) + 300);
    const swapParams = encodeAbiParameters(
      parseAbiParameters("address, address, uint24, address, uint256, uint256, uint160"),
      [usdcAddress, tokenAddress, quote.fee, account.address, amountIn, amountOutMinimum, 0n]
    );

    const txHash = await walletClient.writeContract({
      address: UNIVERSAL_ROUTER,
      abi: [{ name: "execute", type: "function", inputs: [{ name: "commands", type: "bytes" }, { name: "inputs", type: "bytes[]" }, { name: "deadline", type: "uint256" }], outputs: [] }] as const,
      functionName: "execute",
      args: ["0x00" as Hex, [swapParams], DEADLINE],
    });
    submittedTxHash = txHash;

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const amountOutRaw = parseTransferAmountOutRaw(receipt as any, tokenAddress, account.address);
    const amountOut = Number(formatUnits(BigInt(amountOutRaw), quote.outputDecimals));
    const success = receipt.status === "success" && BigInt(amountOutRaw) > 0n && Number.isFinite(amountOut);

    logger.info({ chain, txHash, amountUsd, amountOut, fee: quote.fee }, "EVM BUY executed");
    return {
      success,
      txHash,
      amountIn: amountUsd,
      amountOut,
      amountOutRaw,
      outputDecimals: quote.outputDecimals,
      fee: quote.fee,
      gasUsed: Number(receipt.gasUsed),
      error: success ? undefined : "Swap receipt succeeded without a verifiable token output",
    };
  } catch (err: any) {
    logger.error({ err, chain }, "EVM buy execution failed");
    return { success: false, txHash: submittedTxHash, amountIn: amountUsd, amountOut: 0, error: err?.message ?? String(err) };
  }
}

export async function executeSellEVM(
  chain: string,
  tokenAddress: Address,
  tokenAmount: number,
  tokenDecimals?: number,
  slippagePct: number = 0.5,
  tokenAmountRaw?: string,
): Promise<SwapResult> {
  const key = getPrivateKey(chain);
  if (!key) return { success: false, amountIn: 0, amountOut: 0, error: "No wallet private key configured" };
  if (!["ethereum", "base"].includes(chain) || !isAddress(tokenAddress)) {
    return { success: false, amountIn: tokenAmount, amountOut: 0, error: "Invalid EVM sell parameters" };
  }

  const { viemChain, rpc } = getChainConfig(chain);
  const usdcAddress = TOKENS[chain]?.["USDC"];
  if (!usdcAddress) return { success: false, amountIn: 0, amountOut: 0, error: "No USDC token" };

  let submittedTxHash: Hex | undefined;
  try {
    const account = privateKeyToAccount(key);
    const publicClient = createPublicClient({ chain: viemChain, transport: http(rpc) });
    const walletClient = createWalletClient({ account, chain: viemChain, transport: http(rpc) });

    const verifiedDecimals = await getEvmTokenDecimals(chain, tokenAddress);
    if (verifiedDecimals === null || (tokenDecimals !== undefined && tokenDecimals !== verifiedDecimals)) {
      return { success: false, amountIn: tokenAmount, amountOut: 0, error: "Could not verify EVM token decimals" };
    }
    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
      return { success: false, amountIn: tokenAmount, amountOut: 0, error: "Sell amount must be positive" };
    }
    const amountIn = tokenAmountRaw === undefined
      ? parseUnits(tokenAmount.toFixed(Math.min(verifiedDecimals, 9)), verifiedDecimals)
      : /^\d+$/.test(tokenAmountRaw) ? BigInt(tokenAmountRaw) : 0n;
    if (amountIn <= 0n) {
      return { success: false, amountIn: tokenAmount, amountOut: 0, error: "Invalid raw token sell amount" };
    }
    const tokenBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }) as bigint;
    if (tokenBalance < amountIn) {
      return { success: false, amountIn: tokenAmount, amountOut: 0, error: "Wallet token balance is below the requested close amount" };
    }

    // --- Quote: find best fee tier ---
    const quote = await getBestQuote(chain, tokenAddress, usdcAddress, amountIn);
    if (!quote) {
      return { success: false, amountIn: tokenAmount, amountOut: 0, error: "No V3 pool found for this token on any fee tier" };
    }
    const slippageMultiplier = getSlippageMultiplier(slippagePct);
    const amountOutMinimum = (quote.amountOut * slippageMultiplier) / 10000n;
    if (amountOutMinimum <= 0n) {
      return { success: false, amountIn: tokenAmount, amountOut: 0, error: "Quoted minimum output rounds to zero" };
    }

    logger.info({ chain, tokenAddress, fee: quote.fee, tokenAmount, amountOutRaw: quote.amountOut.toString() }, "EVM SELL quote");

    await ensureRouterAllowance(chain, account, walletClient, publicClient, tokenAddress, amountIn);

    // --- Execute swap via Universal Router ---
    const DEADLINE = BigInt(Math.floor(Date.now() / 1000) + 300);
    const swapParams = encodeAbiParameters(
      parseAbiParameters("address, address, uint24, address, uint256, uint256, uint160"),
      [tokenAddress, usdcAddress, quote.fee, account.address, amountIn, amountOutMinimum, 0n]
    );

    const txHash = await walletClient.writeContract({
      address: UNIVERSAL_ROUTER,
      abi: [{ name: "execute", type: "function", inputs: [{ name: "commands", type: "bytes" }, { name: "inputs", type: "bytes[]" }, { name: "deadline", type: "uint256" }], outputs: [] }] as const,
      functionName: "execute",
      args: ["0x00" as Hex, [swapParams], DEADLINE],
    });
    submittedTxHash = txHash;

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const amountOutRaw = parseTransferAmountOutRaw(receipt as any, usdcAddress, account.address);
    const amountOut = Number(formatUnits(BigInt(amountOutRaw), 6));
    const success = receipt.status === "success" && BigInt(amountOutRaw) > 0n && Number.isFinite(amountOut);

    logger.info({ chain, txHash, tokenAmount, amountOut, fee: quote.fee }, "EVM SELL executed");
    return {
      success,
      txHash,
      amountIn: tokenAmount,
      amountOut,
      amountOutRaw,
      outputDecimals: 6,
      fee: quote.fee,
      gasUsed: Number(receipt.gasUsed),
      error: success ? undefined : "Swap receipt succeeded without a verifiable USDC output",
    };
  } catch (err: any) {
    logger.error({ err, chain }, "EVM sell execution failed");
    return { success: false, txHash: submittedTxHash, amountIn: tokenAmount, amountOut: 0, error: err?.message ?? String(err) };
  }
}
