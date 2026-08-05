import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { X, Camera } from "lucide-react";

interface Props {
  onScan: (result: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let frameId: number;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        setError("Could not access the camera. Check your browser permissions.");
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code?.data) {
            onScan(code.data);
            return; // stop the loop once we have a hit
          }
        }
      }
      frameId = requestAnimationFrame(tick);
    }

    start();
    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(17,24,39,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "#ffffff", borderRadius: 20, padding: "1.25rem", maxWidth: 380, width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Camera size={16} color="#6D5EF7" />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>Scan to Pay</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#6B7280" }}>
            <X size={18} />
          </button>
        </div>

        {error ? (
          <div style={{ padding: "2rem 1rem", textAlign: "center", color: "#DC2626", fontSize: 13 }}>{error}</div>
        ) : (
          <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "#111827" }}>
            <video ref={videoRef} style={{ width: "100%", display: "block" }} muted playsInline />
            <div style={{ position: "absolute", inset: 24, border: "2px solid rgba(255,255,255,0.6)", borderRadius: 12, pointerEvents: "none" }} />
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: "none" }} />

        <p style={{ fontSize: 11.5, color: "#6B7280", textAlign: "center", margin: 0 }}>
          Point your camera at a FlowFi wallet QR code.
        </p>
      </div>
    </div>
  );
}
