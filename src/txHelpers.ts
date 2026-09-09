import type { TransactionReceipt } from "viem";

// A transaction can be mined (included in a block, consuming gas) and still
// have FAILED — e.g. it reverted. `waitForTransactionReceipt` on its own
// resolves either way; only `receipt.status` tells you which happened.
// Every write flow in this app must use this instead of calling
// `waitForTransactionReceipt` directly, or a reverted transaction gets
// reported to the user as a success while no funds actually moved.
//
// Typed structurally (just the one method needed) rather than as viem's full
// PublicClient — clients created with different chain configs are otherwise
// structurally incompatible types in viem, even though every one of them has
// this exact method.
export async function waitForSuccess(
  client: { waitForTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<TransactionReceipt> },
  hash: `0x${string}`
) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Transaction was mined but reverted on-chain — no funds moved. Check the transaction on Arcscan for the exact reason.");
  }
  return receipt;
}
