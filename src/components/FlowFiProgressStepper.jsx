import React, { useState, useEffect, useRef, useCallback } from "react";
import { Check, Loader2, ArrowRight, X, ExternalLink, Zap } from "lucide-react";

const BRIDGE_STEPS = [
  { id: "initialize", label: "Başlatılıyor", detail: "İşlem kaynak zincirde imzalanıyor" },
  { id: "execute", label: "Bridge çalışıyor", detail: "CCTP V2 üzerinden mesaj aktarılıyor" },
  { id: "finalize", label: "Tamamlanıyor", detail: "Hedef zincirde bakiye senkronize ediliyor" },
];

const PERPS_STEPS = [
  { id: "margin", label: "Teminat kilitleniyor", detail: "USDC teminatı pozisyon için ayrılıyor" },
  { id: "open", label: "Pozisyon açılıyor", detail: "Emir onchain eşleştiriliyor" },
  { id: "sync", label: "PNL senkronize ediliyor", detail: "Canlı fiyat akışına bağlanıyor" },
];

export default function FlowFiProgressStepper() {
  const [mode, setMode] = useState("bridge");
  const [activeStep, setActiveStep] = useState(-1);
  const [completed, setCompleted] = useState(false);
  const [toast, setToast] = useState(null);
  const timeoutsRef = useRef([]);

  const steps = mode === "bridge" ? BRIDGE_STEPS : PERPS_STEPS;

  const clearTimers = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  const runFlow = () => {
    clearTimers();
    setCompleted(false);
    setToast(null);
    setActiveStep(0);

    steps.forEach((_, i) => {
      const t = setTimeout(() => setActiveStep(i + 1), (i + 1) * 1100);
      timeoutsRef.current.push(t);
    });

    const doneTimer = setTimeout(() => {
      setCompleted(true);
      setToast({
        title: "İşlem tamamlandı",
        detail: mode === "bridge" ? "Base Sepolia #4 tamamlandı" : "Pozisyon aktif · PNL takibi başladı",
      });
    }, steps.length * 1100 + 300);
    timeoutsRef.current.push(doneTimer);

    const toastGone = setTimeout(() => setToast(null), steps.length * 1100 + 4500);
    timeoutsRef.current.push(toastGone);
  };

  useEffect(() => () => clearTimers(), [clearTimers]);

  const switchMode = (m) => {
    clearTimers();
    setMode(m);
    setActiveStep(-1);
    setCompleted(false);
    setToast(null);
  };

  return (
    <div className="relative w-full min-h-screen bg-slate-950 text-slate-100 overflow-hidden">
      <style>{`
        @keyframes flowDrift { 0% { transform: translate(-10%,-5%) rotate(0deg); } 50% { transform: translate(6%,8%) rotate(180deg); } 100% { transform: translate(-10%,-5%) rotate(360deg); } }
        @keyframes lineGrow { from { stroke-dashoffset: 60; } to { stroke-dashoffset: 0; } }
        @keyframes dashFlow { to { stroke-dashoffset: -40; } }
        @keyframes ringPulse { 0% { box-shadow: 0 0 0 0 rgba(34,211,238,0.45); } 70% { box-shadow: 0 0 0 10px rgba(34,211,238,0); } 100% { box-shadow: 0 0 0 0 rgba(34,211,238,0); } }
        @keyframes toastIn { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .flow-blob { animation: flowDrift 24s ease-in-out infinite; }
        .active-ring { animation: ringPulse 1.6s ease-out infinite; }
        .toast-enter { animation: toastIn 0.3s ease-out; }
        .connector-active { stroke-dasharray: 6 8; animation: dashFlow 0.9s linear infinite; }
        .font-display { font-family: "Space Grotesk", "Inter", sans-serif; }
        .font-mono-num { font-family: "JetBrains Mono", ui-monospace, monospace; }
      `}</style>

      <div className="pointer-events-none absolute inset-0">
        <div className="flow-blob absolute -top-40 -right-20 w-[500px] h-[500px] rounded-full opacity-25 blur-3xl" style={{ background: "radial-gradient(circle, #6366F1 0%, transparent 70%)" }} />
        <div className="flow-blob absolute bottom-0 -left-20 w-[440px] h-[440px] rounded-full opacity-20 blur-3xl" style={{ background: "radial-gradient(circle, #22D3EE 0%, transparent 70%)", animationDelay: "-10s" }} />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-6 py-12">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 flex items-center justify-center">
            <Zap size={16} className="text-slate-950" />
          </div>
          <span className="font-display text-lg font-semibold tracking-tight">FlowFi</span>
        </div>

        <div className="flex gap-2 mb-6">
          <ModeTab active={mode === "bridge"} onClick={() => switchMode("bridge")} label="Bridge" />
          <ModeTab active={mode === "perps"} onClick={() => switchMode("perps")} label="Perpetuals" />
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 backdrop-blur-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="font-display text-sm font-medium text-slate-200">
                {mode === "bridge" ? "Ethereum Sepolia → Base Sepolia" : "USDC-PERP · Long 3x"}
              </div>
              <div className="text-xs text-slate-500 mt-0.5 font-mono-num">
                {mode === "bridge" ? "1.0000 USDC" : "250.00 USDC teminat"}
              </div>
            </div>
            {completed && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2 py-1 rounded-full">
                <Check size={11} /> Tamamlandı
              </span>
            )}
          </div>

          <StepperTrack steps={steps} activeStep={activeStep} completed={completed} />

          <button
            onClick={runFlow}
            disabled={activeStep >= 0 && !completed}
            className="mt-7 w-full py-3.5 rounded-xl font-display font-medium text-sm bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 hover:from-cyan-300 hover:to-indigo-400 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {activeStep >= 0 && !completed ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                İşleniyor...
              </>
            ) : completed ? (
              "Tekrar çalıştır"
            ) : mode === "bridge" ? (
              "Bridge'i başlat"
            ) : (
              "Pozisyonu aç"
            )}
          </button>
        </div>
      </div>

      {toast && (
        <div className="toast-enter fixed bottom-6 right-6 z-20 w-80 rounded-xl border border-slate-800 bg-slate-900/95 backdrop-blur-xl p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-emerald-400/15 border border-emerald-400/30 flex items-center justify-center shrink-0 mt-0.5">
                <Check size={13} className="text-emerald-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-100">{toast.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{toast.detail}</div>
                <button className="flex items-center gap-1 text-[11px] text-cyan-400 mt-1.5 hover:text-cyan-300">
                  Detayları gör <ExternalLink size={10} />
                </button>
              </div>
            </div>
            <button onClick={() => setToast(null)} className="text-slate-600 hover:text-slate-400 shrink-0">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeTab({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors border " +
        (active
          ? "bg-cyan-400/10 border-cyan-400/30 text-cyan-300"
          : "bg-transparent border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700")
      }
    >
      {label}
    </button>
  );
}

function StepperTrack({ steps, activeStep, completed }) {
  return (
    <div>
      {steps.map((step, i) => {
        const isDone = completed || activeStep > i;
        const isActive = !completed && activeStep === i;
        const isLast = i === steps.length - 1;
        const isPending = activeStep < i && !completed;

        return (
          <div key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={
                  "w-7 h-7 rounded-full flex items-center justify-center border shrink-0 " +
                  (isDone
                    ? "bg-emerald-400 border-emerald-400"
                    : isActive
                    ? "bg-cyan-400/15 border-cyan-400 active-ring"
                    : "bg-slate-900 border-slate-700")
                }
              >
                {isDone ? (
                  <Check size={13} className="text-slate-950" />
                ) : isActive ? (
                  <Loader2 size={13} className="text-cyan-300 animate-spin" />
                ) : (
                  <span className="text-[11px] font-mono-num text-slate-600">{i + 1}</span>
                )}
              </div>
              {!isLast && (
                <svg width="2" height="32" className="my-0.5">
                  <line
                    x1="1" y1="0" x2="1" y2="32"
                    stroke={isDone ? "#34D399" : "#334155"}
                    strokeWidth="2"
                    className={isActive ? "connector-active" : ""}
                  />
                </svg>
              )}
            </div>
            <div className={"pb-6 " + (isLast ? "pb-0" : "")}>
              <div
                className={
                  "text-sm font-medium " +
                  (isDone ? "text-slate-300" : isActive ? "text-slate-100" : "text-slate-600")
                }
              >
                {step.label}
              </div>
              <div className={"text-xs mt-0.5 " + (isPending ? "text-slate-700" : "text-slate-500")}>
                {step.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
