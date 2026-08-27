import { pad, type Address } from "viem";

// Circle Gateway instant transfer (<500ms) — burn on source, mint on
// destination, without waiting for source-chain finality.
//
// EVERY type definition, field name, and field order below is copied
// VERBATIM from Circle's own official source (circlefin/evm-gateway-contracts,
// src/lib/TransferSpec.sol and src/lib/BurnIntents.sol) and their EIP-712
// domain (circlefin/skills use-gateway reference). Per Circle's own skill
// rules: "NEVER modify EIP-712 type definitions... changing field names,
// types, ordering, or omitting fields produces invalid signatures."
// Do not "clean up" or reorder anything below.

export const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as const;
export const GATEWAY_MINTER_ADDRESS = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as const;
export const GATEWAY_TRANSFER_API = "https://gateway-api-testnet.circle.com/v1/transfer";

// Chain-agnostic EIP-712 domain — deliberately has no chainId/verifyingContract,
// so one signature covers the transfer regardless of source/destination chain.
const EIP712_DOMAIN = { name: "GatewayWallet", version: "1" } as const;

const EIP712_TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" },
    { name: "sourceDomain", type: "uint32" },
    { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" },
    { name: "destinationContract", type: "bytes32" },
    { name: "sourceToken", type: "bytes32" },
    { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" },
    { name: "destinationRecipient", type: "bytes32" },
    { name: "sourceSigner", type: "bytes32" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" },
    { name: "salt", type: "bytes32" },
    { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [
    { name: "maxBlockHeight", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "spec", type: "TransferSpec" },
  ],
} as const;

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

function addressToBytes32(addr: Address): `0x${string}` {
  return pad(addr, { size: 32 });
}

export interface BuildBurnIntentParams {
  sourceDomain: number;
  destinationDomain: number;
  sourceTokenAddress: Address;
  destinationTokenAddress: Address;
  depositorAddress: Address; // the Gateway balance owner (source signer, unless using a delegate)
  recipientAddress: Address; // who receives on the destination chain
  amountUnits: bigint; // 6-decimal USDC units
  maxBlockHeight: bigint; // an expiration block height on the SOURCE chain, comfortably in the future
  maxFeeUnits: bigint; // ceiling on Circle's fee, in 6-decimal USDC units — actual fee charged may be lower
}

/**
 * Builds the exact typed-data message + types + domain for a burn intent,
 * ready to pass to viem's signTypedData / Circle DCW's typed-data signing.
 * Also returns the plain burnIntent object (with a hex salt) to send back
 * to the Gateway API alongside the signature, as the API expects.
 */
export function buildBurnIntentTypedData(params: BuildBurnIntentParams) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const saltHex = ("0x" + Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;

  const spec = {
    version: 1,
    sourceDomain: params.sourceDomain,
    destinationDomain: params.destinationDomain,
    sourceContract: addressToBytes32(GATEWAY_WALLET_ADDRESS),
    destinationContract: addressToBytes32(GATEWAY_MINTER_ADDRESS),
    sourceToken: addressToBytes32(params.sourceTokenAddress),
    destinationToken: addressToBytes32(params.destinationTokenAddress),
    sourceDepositor: addressToBytes32(params.depositorAddress),
    destinationRecipient: addressToBytes32(params.recipientAddress),
    sourceSigner: addressToBytes32(params.depositorAddress),
    destinationCaller: ZERO_BYTES32, // 0 = any caller may submit the mint
    value: params.amountUnits,
    salt: saltHex,
    hookData: "0x" as `0x${string}`,
  };

  const burnIntent = {
    maxBlockHeight: params.maxBlockHeight,
    maxFee: params.maxFeeUnits,
    spec,
  };

  return {
    domain: EIP712_DOMAIN,
    types: EIP712_TYPES,
    primaryType: "BurnIntent" as const,
    message: burnIntent,
  };
}

export interface TransferAttestationResult {
  attestation: `0x${string}`;
  signature: `0x${string}`;
}

/**
 * Submits a signed burn intent to Circle's Gateway API and requests an
 * attestation authorizing the mint on the destination chain.
 */
export async function requestTransferAttestation(
  burnIntent: ReturnType<typeof buildBurnIntentTypedData>["message"],
  signature: `0x${string}`
): Promise<TransferAttestationResult> {
  const serializable = JSON.parse(
    JSON.stringify(burnIntent, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );

  const res = await fetch(GATEWAY_TRANSFER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify([{ burnIntent: serializable, signature }]),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new Error(errorBody.message || `Gateway API request failed (${res.status})`);
  }

  const result = await res.json();
  const first = Array.isArray(result) ? result[0] : result;
  if (!first?.attestation || !first?.signature) {
    throw new Error("Gateway API did not return an attestation — the transfer may not have been valid.");
  }
  return { attestation: first.attestation, signature: first.signature };
}

export const GATEWAY_MINTER_ABI = [
  {
    type: "function",
    name: "gatewayMint",
    inputs: [
      { name: "attestationPayload", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
