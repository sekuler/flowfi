import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";
import { createWalletClient, createPublicClient, custom, http, erc20Abi, parseUnits, formatUnits } from "viem";
import { arcTestnet, ARC_CHAIN_ID_HEX } from "../chains";
import { showToast } from "../toast";

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;
const EURC_ADDRESS = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`;
const LENDING_CONTRACT = "0xD3e0171CaCd799E49155eE48981841E9a9d225ab" as `0x${string}`;

const LENDING_ABI = [
  { type: "function", name: "supply", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "shareAmount", type: "uint256" }], outputs: [] },
  { type: "function", name: "depositCollateral", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawCollateral", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "borrow", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "repay", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "supplyBalance", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "suppliedShares", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "collateralBalance", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "debtOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "maxBorrowable", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "healthFactor", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "currentAPR", stateMutability: "view", inputs: [], outputs: [{ name: "bps", type: "uint256" }] },
  { type: "function", name: "getMarketInfo", stateMutability: "view", inputs: [], outputs: [{ name: "_totalSupplied", type: "uint256" }, { name: "_totalBorrowed", type: "uint256" }, { name: "_availableLiquidity", type: "uint256" }] },
] as const;

interface Props {
  provider: EIP1193Provider;
  address: string;
  balances: { usdc: string | null; eurc: string | null; usyc: string | null; native: string | null };
  onRefresh: () => void;
}

async function switchToArc(provider: EIP1193Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
  } catch (e: unknown) {
    const err = e as { code?: number };
    if (err.code === 4902) {
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://arc-testnet.g.alchemy.com/v2/alch_1L2dTNapY_mz3YEIsoVEN"], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
    } else throw e;
  }
}

export default function LendingForm({ provider, address, balances, onRefresh }: Props) {
  const [tab, setTab] = useState<"supply" | "borrow">("supply");
  const [supplyAmount, setSupplyAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [state, setState] = useState<"idle" | "approving" | "processing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [marketInfo, setMarketInfo] = useState<{ supplied: string; borrowed: string; available: string; apr: string } | null>(null);
  const [mySupply, setMySupply] = useState<string>("0.00");
  const [myCollateral, setMyCollateral] = useState<string>("0.00");
  const [myDebt, setMyDebt] = useState<string>("0.00");
  const [myMaxBorrow, setMyMaxBorrow] = useState<string>("0.00");
  const [myHealth, setMyHealth] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    try {
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const [supplied, borrowed, available] = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "getMarketInfo" });
      const apr = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "currentAPR" });
      setMarketInfo({
        supplied: Number(formatUnits(supplied, 6)).toFixed(2),
        borrowed: Number(formatUnits(borrowed, 6)).toFixed(2),
        available: Number(formatUnits(available, 6)).toFixed(2),
        apr: (Number(apr) / 100).toFixed(2),
      });

      const sup = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "supplyBalance", args: [address as `0x${string}`] });
      setMySupply(Number(formatUnits(sup, 6)).toFixed(4));

      const coll = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "collateralBalance", args: [address as `0x${string}`] });
      setMyCollateral(Number(formatUnits(coll, 6)).toFixed(4));

      const debt = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "debtOf", args: [address as `0x${string}`] });
      setMyDebt(Number(formatUnits(debt, 6)).toFixed(4));

      const maxB = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "maxBorrowable", args: [address as `0x${string}`] });
      setMyMaxBorrow(Number(formatUnits(maxB, 6)).toFixed(4));

      const health = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "healthFactor", args: [address as `0x${string}`] });
      setMyHealth(health > 100000n ? null : Number(health) / 100);
    } catch {
      /* keep previous state on error */
    }
  }, [address]);

  useEffect(() => { loadData(); }, [loadData]);

  async function doSupply() {
    if (!supplyAmount || Number(supplyAmount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const units = parseUnits(supplyAmount, 6);

      setState("approving");
      const a1 = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [LENDING_CONTRACT, units], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a1 });

      setState("processing");
      const hash = await wc.writeContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "supply", args: [units], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle"); setSupplyAmount("");
      showToast("Supplied to lending pool", "success");
      await loadData(); onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to supply."); setState("error");
    }
  }

  async function doWithdraw() {
    if (!withdrawAmount || Number(withdrawAmount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const client = createPublicClient({ chain: arcTestnet, transport: http() });
      const myShares = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "suppliedShares", args: [address as `0x${string}`] });
      const mySupplyBal = await client.readContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "supplyBalance", args: [address as `0x${string}`] });
      const fraction = (parseUnits(withdrawAmount, 6) * 1000000n) / (mySupplyBal || 1n);
      const sharesToWithdraw = (myShares * fraction) / 1000000n;

      setState("processing");
      const hash = await wc.writeContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "withdraw", args: [sharesToWithdraw], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle"); setWithdrawAmount("");
      showToast("Withdrawn from lending pool", "success");
      await loadData(); onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to withdraw."); setState("error");
    }
  }

  async function doDepositCollateral() {
    if (!collateralAmount || Number(collateralAmount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const units = parseUnits(collateralAmount, 6);

      setState("approving");
      const a1 = await wc.writeContract({ address: EURC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [LENDING_CONTRACT, units], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a1 });

      setState("processing");
      const hash = await wc.writeContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "depositCollateral", args: [units], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle"); setCollateralAmount("");
      showToast("Collateral deposited", "success");
      await loadData(); onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to deposit collateral."); setState("error");
    }
  }

  async function doBorrow() {
    if (!borrowAmount || Number(borrowAmount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const units = parseUnits(borrowAmount, 6);

      setState("processing");
      const hash = await wc.writeContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "borrow", args: [units], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle"); setBorrowAmount("");
      showToast("Borrowed successfully", "success");
      await loadData(); onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to borrow."); setState("error");
    }
  }

  async function doRepay() {
    if (!repayAmount || Number(repayAmount) <= 0) { setErrorMsg("Enter a valid amount."); return; }
    setErrorMsg(null);
    try {
      await switchToArc(provider);
      const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
      const wc = createWalletClient({ chain: arcTestnet, transport: custom(provider) });
      const units = parseUnits(repayAmount, 6);

      setState("approving");
      const a1 = await wc.writeContract({ address: USDC_ADDRESS, abi: erc20Abi, functionName: "approve", args: [LENDING_CONTRACT, units], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash: a1 });

      setState("processing");
      const hash = await wc.writeContract({ address: LENDING_CONTRACT, abi: LENDING_ABI, functionName: "repay", args: [units], account: address as `0x${string}` });
      await publicClient.waitForTransactionReceipt({ hash });

      setState("idle"); setRepayAmount("");
      showToast("Repaid successfully", "success");
      await loadData(); onRefresh();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setErrorMsg(err.message ?? "Failed to repay."); setState("error");
    }
  }

  const isLoading = state === "approving" || state === "processing";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: 460 }}>
      <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 10, padding: "0.75rem 1rem" }}>
        <p style={{ fontSize: 12, color: "#5B21B6", margin: 0 }}>
          Supply USDC to earn interest, or deposit EURC as collateral to borrow USDC. 75% max LTV, liquidation at 85%.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.8rem" }}>
          <div style={{ fontSize: 9, color: "#4B5563", fontWeight: 700, marginBottom: 4 }}>TOTAL SUPPLIED</div>
          <div style={{ fontSize: 15, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>${marketInfo?.supplied ?? "..."}</div>
        </div>
        <div style={{ background: "#f5f3ff", borderRadius: 12, padding: "0.8rem" }}>
          <div style={{ fontSize: 9, color: "#4B5563", fontWeight: 700, marginBottom: 4 }}>UTILIZED</div>
          <div style={{ fontSize: 15, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>${marketInfo?.borrowed ?? "..."}</div>
        </div>
        <div style={{ background: "rgba(52,211,153,0.1)", borderRadius: 12, padding: "0.8rem" }}>
          <div style={{ fontSize: 9, color: "#16A34A", fontWeight: 700, marginBottom: 4 }}>SUPPLY APR</div>
          <div style={{ fontSize: 15, color: "#16A34A", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{marketInfo?.apr ?? "..."}%</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => setTab("supply")}
          style={{ flex: 1, padding: "0.65rem", borderRadius: 10, border: "none", background: tab === "supply" ? "#ede9fe" : "#f5f3ff", color: tab === "supply" ? "#5B21B6" : "#4B5563", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Supply / Earn
        </button>
        <button onClick={() => setTab("borrow")}
          style={{ flex: 1, padding: "0.65rem", borderRadius: 10, border: "none", background: tab === "borrow" ? "#ede9fe" : "#f5f3ff", color: tab === "borrow" ? "#5B21B6" : "#4B5563", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          Borrow
        </button>
      </div>

      {tab === "supply" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "0.9rem 1rem" }}>
            <div style={{ fontSize: 11, color: "#4B5563" }}>Your Supply Balance</div>
            <div style={{ fontSize: 22, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{mySupply} <span style={{ fontSize: 13, color: "#4B5563", fontWeight: 500 }}>USDC</span></div>
          </div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", display: "flex", flexDirection: "column", gap: 10 , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#6B7280" }}>Supply USDC — Balance: {balances.usdc ?? "..."}</label>
              <button onClick={() => setSupplyAmount(balances.usdc ?? "0")} disabled={isLoading} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>MAX</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" min="0" placeholder="0.00" value={supplyAmount} onChange={(e) => setSupplyAmount(e.target.value)} disabled={isLoading}
                style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.65rem 0.8rem", fontSize: 15, color: "#111827", outline: "none" }} />
              <button onClick={doSupply} disabled={isLoading}
                style={{ padding: "0.6rem 1.2rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#ffffff", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                {state === "approving" ? "Approving..." : state === "processing" ? "Supplying..." : "Supply"}
              </button>
            </div>
          </div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", display: "flex", flexDirection: "column", gap: 10 , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#6B7280" }}>Withdraw USDC</label>
              <button onClick={() => setWithdrawAmount(mySupply)} disabled={isLoading} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>MAX</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" min="0" placeholder="0.00" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} disabled={isLoading}
                style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.65rem 0.8rem", fontSize: 15, color: "#111827", outline: "none" }} />
              <button onClick={doWithdraw} disabled={isLoading}
                style={{ padding: "0.6rem 1.2rem", borderRadius: 10, border: "none", background: "#ede9fe", color: "#111827", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                {state === "processing" ? "Withdrawing..." : "Withdraw"}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "borrow" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "0.9rem 1rem" }}>
              <div style={{ fontSize: 10, color: "#4B5563" }}>Your Collateral</div>
              <div style={{ fontSize: 17, color: "#111827", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{myCollateral} <span style={{ fontSize: 12, color: "#4B5563" }}>EURC</span></div>
            </div>
            <div style={{ background: "#f5f3ff", borderRadius: 14, padding: "0.9rem 1rem" }}>
              <div style={{ fontSize: 10, color: "#4B5563" }}>Your Debt</div>
              <div style={{ fontSize: 17, color: "#DC2626", fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{myDebt} <span style={{ fontSize: 12, color: "#4B5563" }}>USDC</span></div>
            </div>
          </div>

          {myHealth !== null && (
            <div style={{ background: myHealth < 110 ? "rgba(239,68,68,0.12)" : "rgba(52,211,153,0.1)", borderRadius: 14, padding: "0.9rem 1rem" }}>
              <div style={{ fontSize: 10, color: "#4B5563", marginBottom: 2 }}>Health Factor</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: myHealth < 110 ? "#DC2626" : "#16A34A", fontFamily: "ui-monospace, monospace" }}>{myHealth.toFixed(1)}%</div>
              {myHealth < 110 && <p style={{ fontSize: 11, color: "#DC2626", margin: "4px 0 0 0" }}>Close to liquidation. Add collateral or repay debt.</p>}
            </div>
          )}

          <div style={{ fontSize: 12, color: "#4B5563" }}>Max borrowable: <span style={{ color: "#111827", fontWeight: 700 }}>{myMaxBorrow} USDC</span></div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", display: "flex", flexDirection: "column", gap: 10 , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#6B7280" }}>Deposit Collateral (EURC) — Balance: {balances.eurc ?? "..."}</label>
              <button onClick={() => setCollateralAmount(balances.eurc ?? "0")} disabled={isLoading} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>MAX</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" min="0" placeholder="0.00" value={collateralAmount} onChange={(e) => setCollateralAmount(e.target.value)} disabled={isLoading}
                style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.65rem 0.8rem", fontSize: 15, color: "#111827", outline: "none" }} />
              <button onClick={doDepositCollateral} disabled={isLoading}
                style={{ padding: "0.6rem 1.2rem", borderRadius: 10, border: "none", background: "#6D5EF7", color: "#ffffff", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                {state === "approving" ? "Approving..." : state === "processing" ? "Depositing..." : "Deposit"}
              </button>
            </div>
          </div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", display: "flex", flexDirection: "column", gap: 10 , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#6B7280" }}>Borrow USDC</label>
              <button onClick={() => setBorrowAmount(myMaxBorrow)} disabled={isLoading} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>MAX</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" min="0" placeholder="0.00" value={borrowAmount} onChange={(e) => setBorrowAmount(e.target.value)} disabled={isLoading}
                style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.65rem 0.8rem", fontSize: 15, color: "#111827", outline: "none" }} />
              <button onClick={doBorrow} disabled={isLoading}
                style={{ padding: "0.6rem 1.2rem", borderRadius: 10, border: "none", background: "#ef4444", color: "#fff", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                {state === "processing" ? "Borrowing..." : "Borrow"}
              </button>
            </div>
          </div>

          <div style={{ background: "#ffffff", borderRadius: 18, padding: "1.1rem", display: "flex", flexDirection: "column", gap: 10 , boxShadow: "0 1px 3px rgba(124,58,237,0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#6B7280" }}>Repay USDC — Balance: {balances.usdc ?? "..."}</label>
              <button onClick={() => setRepayAmount(Number(myDebt) < Number(balances.usdc ?? 0) ? myDebt : (balances.usdc ?? "0"))} disabled={isLoading} style={{ background: "none", border: "none", color: "#6D5EF7", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: 0 }}>MAX</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" min="0" placeholder="0.00" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} disabled={isLoading}
                style={{ flex: 1, background: "#f5f3ff", border: "none", borderRadius: 10, padding: "0.65rem 0.8rem", fontSize: 15, color: "#111827", outline: "none" }} />
              <button onClick={doRepay} disabled={isLoading}
                style={{ padding: "0.6rem 1.2rem", borderRadius: 10, border: "none", background: "#ede9fe", color: "#111827", fontSize: 13, fontWeight: 700, cursor: isLoading ? "not-allowed" : "pointer", opacity: isLoading ? 0.6 : 1 }}>
                {state === "approving" ? "Approving..." : state === "processing" ? "Repaying..." : "Repay"}
              </button>
            </div>
          </div>
        </div>
      )}

      {errorMsg && <div style={{ background: "rgba(239,68,68,0.12)", borderRadius: 10, padding: "0.75rem 1rem", color: "#DC2626", fontSize: 13 }}>{errorMsg}</div>}
    </div>
  );
}
