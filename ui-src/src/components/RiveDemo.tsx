"use client";

import { useEffect } from "react";
import { useRive, Layout, Fit, Alignment, StateMachineInputType } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

/**
 * Resmi React Wrapper Pattern'i:
 * RiveComponent yerine setContainerRef ve setCanvasRef kullanarak,
 * hook'un canvas'ı ve event'leri doğru zamanlamayla (layout sonrasında)
 * başlatmasını sağlıyoruz. Bu sayede Rive'ın native hover (ViewModel Listener)
 * özellikleri engelsiz ve doğru boyutlarda çalışır.
 */
export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const sm = stateMachines?.[0];

  const { rive, setCanvasRef, setContainerRef } = useRive({
    src,
    artboard: artboard || undefined,
    stateMachines: sm || undefined,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  // Trigger input'ları (Click ile ateşlenen animasyonlar)
  const handlePointerDown = () => {
    if (!rive || !sm) return;
    try {
      const inputs = rive.stateMachineInputs(sm) ?? [];
      const triggers = inputs.filter((i: any) => i.type === StateMachineInputType.Trigger);
      triggers.forEach((t: any) => { try { t.fire(); } catch (_) {} });
    } catch (_) {}
  };

  return (
    <div
      ref={setContainerRef}
      style={{ width: "100%", height: "100%", position: "relative", display: "flex" }}
    >
      <canvas
        ref={setCanvasRef}
        onPointerDown={handlePointerDown}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          pointerEvents: "auto",  // Overlay'lerin engellemesini önlemek için
          touchAction: "none"     // Mobilde scroll çatışmasını engellemek için
        }}
      />
    </div>
  );
}
