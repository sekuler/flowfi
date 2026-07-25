import React, { useState, useEffect, useRef } from "react";
import { ArrowDown, ChevronDown, Zap, Info, Activity, Layers } from "lucide-react";

const TOKENS = {
  USDC: { symbol: "USDC", color: "#22D3EE", name: "USD Coin" },
  EURC: { symbol: "EURC", color: "#6366F1", name: "Euro Coin" },
};

export default function FlowFiSwap() {
  const [fromToken, setFromToken] = useState("USDC");
  const [toToken, setToToken] = useState("EURC");
  const [amount, setAmount] = useState("1");
  const [isSwapping, setIsSwapping] = useState(false);
  const [flowPulse, setFlowPulse] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFlowPulse((p) => (p + 1) % 1000), 60);
    return () => clearInterval(id);
  }, []);

  const estOutput = (parseFloat(amount || "0") * 0.6).toFixed(4);

  const handleSwap = () => {
    setIsSwapping(true);
    setTimeout(() => setIsSwapping(false), 2200);
  };

  return (
    <div className="relative w-full min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <style>{`
        @keyframes flowDrift {
          0% { transform: translate(-10%, -5%) rotate(0deg) scale(1); }
          50% { transform: translate(5%, 8%) rotate(180deg) scale(1.15); }
          100% { transform: translate(-10%, -5%) rotate(360deg) scale(1); }
        }
        @keyframes flowDrift2 {
          0% { transform: translate(10%, 5%) rotate(0deg) scale(1.1); }
          50% { transform: translate(-8%, -10%) rotate(-180deg) scale(0.95); }
          100% { transform: translate(10%, 5%) rotate(-360deg) scale(1.1); }
        }
        @keyframes dashFlow {
          to { stroke-dashoffset: -40; }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .flow-blob-a { animation: flowDrift 22s ease-in-out infinite; }
        .flow-blob-b { animation: flowDrift2 26s ease-in-out infinite; }
        .flow-line { stroke-dasharray: 6 10; animation: dashFlow 1.2s linear infinite; }
        .flow-glow { animation: pulseGlow 2.4s ease-in-out infinite; }
        .font-display { font-family: "Space Grotesk", "Inter", sans-serif; }
        .font-mono-num { font-family: "JetBrains Mono", ui-monospace, monospace; }
      `}</style>

      {/* Ambient flowing background */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="flow-blob-a absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full opacity-30 blur-3xl"
          style={{ background: "radial-gradient(circle, #22D3EE 0%, transparent 70%)" }}
        />
        <div
          className="flow-blob-b absolute top-1/3 right-0 w-[480px] h-[480px] rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #6366F1 0%, transparent 70%)" }}
        />
        <div
          className="flow-blob-a absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #14B8A6 0%, transparent 70%)", animationDelay: "-8s" }}
        />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center">
              <Zap size={16} className="text-slate-950" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight">FlowFi</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/60 border border-slate-800">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flow-glow" />
              Arc Testnet
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-6 items-start">
          {/* Swap card */}
          <div className="relative rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-xl p-6 shadow-2xl">
            <h2 className="font-display text-sm font-medium text-slate-400 mb-5 tracking-wide">Swap</h2>

            <TokenInput label="Kaydediliyor" token={fromToken} amount={amount} onAmountChange={setAmount} />

            <div className="relative h-10 flex items-center justify-center">
              <svg width="100%" height="40" className="absolute inset-0">
                <line
                  x1="0" y1="20" x2="100%" y2="20"
                  stroke={isSwapping ? "#22D3EE" : "#334155"}
                  strokeWidth="1.5"
                  className={isSwapping ? "flow-line" : ""}
                />
              </svg>
              <button
                onClick={() => { setFromToken(toToken); setToToken(fromToken); }}
                className="relative z-10 w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center hover:border-cyan-400/50 hover:bg-slate-750 transition-colors"
              >
                <ArrowDown size={16} className="text-cyan-400" />
              </button>
            </div>

            <TokenInput label="Alınacak (tahmini)" token={toToken} amount={estOutput} readOnly />

            <button
              onClick={handleSwap}
              disabled={isSwapping}
              className="mt-5 w-full py-3.5 rounded-xl font-display font-medium text-sm bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 hover:from-cyan-300 hover:to-indigo-400 transition-all disabled:opacity-70 flex items-center justify-center gap-2"
            >
              {isSwapping ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-slate-950/30 border-t-slate-950 animate-spin" />
                  İşlem akıyor...
                </>
              ) : (
                "Onayla ve Swap Yap"
              )}
            </button>
          </div>

          {/* Route details */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 backdrop-blur-xl p-5">
            <div className="flex items-center gap-2 mb-4 text-slate-400">
              <Layers size={14} />
              <span className="text-xs font-medium tracking-wide">Rota detayları</span>
            </div>
            <DetailRow label="Beklenen çıktı" value={`${estOutput} ${toToken}`} highlight />
            <DetailRow label="Rota" value="FlowFi Aggregator" />
            <DetailRow label="Yol" value={`${fromToken} → ${toToken}`} mono />
            <DetailRow label="Ağ ücreti" value="~$0.0035 USDC" mono />
            <DetailRow label="Platform ücreti" value="$0" success />

            <div className="mt-4 pt-4 border-t border-slate-800 flex items-start gap-2 text-[11px] text-slate-500">
              <Info size={12} className="mt-0.5 shrink-0" />
              Fiyatlar Arc Testnet üzerindeki canlı likidite havuzlarından geliyor.
            </div>
          </div>
        </div>

        {/* Live activity strip - signature element */}
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 backdrop-blur-xl p-4 flex items-center gap-3 overflow-hidden">
          <Activity size={14} className="text-cyan-400 shrink-0" />
          <span className="text-xs text-slate-400 shrink-0">Canlı akış</span>
          <div className="flex-1 overflow-hidden relative h-5">
            <div
              className="absolute whitespace-nowrap text-xs font-mono-num text-slate-500 flex gap-8"
              style={{ transform: `translateX(-${(flowPulse * 1.2) % 800}px)` }}
            >
              <span>0.34 USDC → EURC</span>
              <span>12.0 EURC → USDC</span>
              <span>1.5 USDC → EURC</span>
              <span>0.8 EURC → USDC</span>
              <span>4.2 USDC → EURC</span>
              <span>0.34 USDC → EURC</span>
              <span>12.0 EURC → USDC</span>
              <span>1.5 USDC → EURC</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenInput({ label, token, amount, onAmountChange, readOnly }) {
  const t = TOKENS[token];
  return (
    <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-4">
      <div className="text-[11px] text-slate-500 mb-2">{label}</div>
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={amount}
          readOnly={readOnly}
          onChange={(e) => onAmountChange && onAmountChange(e.target.value.replace(/[^0-9.]/g, ""))}
          className="bg-transparent text-2xl font-mono-num font-medium outline-none w-full text-slate-100 placeholder-slate-600"
        />
        <button className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 hover:border-slate-600 transition-colors shrink-0">
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-slate-950"
            style={{ background: t.color }}
          >
            {t.symbol[0]}
          </span>
          <span className="text-sm font-medium">{t.symbol}</span>
          <ChevronDown size={13} className="text-slate-500" />
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, value, highlight, mono, success }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-slate-500">{label}</span>
      <span
        className={
          "font-medium " +
          (success ? "text-emerald-400 " : "") +
          (highlight ? "text-slate-100 " : success ? "" : "text-slate-300 ") +
          (mono ? "font-mono-num" : "")
        }
      >
        {value}
      </span>
    </div>
  );
}
