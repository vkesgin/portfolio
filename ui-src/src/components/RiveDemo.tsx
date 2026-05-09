"use client";

import { useEffect, useRef } from "react";
import * as rive from "@rive-app/canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

/**
 * Vanilla Rive API kullanır — React wrapper'ını tamamen atlar.
 * Bu sayede state machine initialization ve pointer events
 * doğrudan Rive runtime'ına bırakılır.
 */
export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const riveRef = useRef<any>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !container) return;

    // Canvas'ı container boyutuna ayarla
    const { width, height } = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const sm = stateMachines?.[0];

    const r = new rive.Rive({
      src,
      canvas,
      artboard: artboard || undefined,
      stateMachines: sm ? [sm] : undefined,
      autoplay: true,
      layout: new rive.Layout({
        fit: rive.Fit.Contain,
        alignment: rive.Alignment.Center,
      }),
      onLoad: () => {
        r.resizeDrawingSurfaceToCanvas();
        console.log("[Rive] Loaded:", src, "| SM:", sm, "| Inputs:", sm ? r.stateMachineInputs(sm)?.map((i: any) => i.name) : []);
      },
      onStateChange: (event: any) => {
        console.log("[Rive] State change:", event.data);
      },
    });

    riveRef.current = r;

    // ResizeObserver ile canvas boyutunu güncelle
    const ro = new ResizeObserver(() => {
      if (!container || !riveRef.current) return;
      const { width: w, height: h } = container.getBoundingClientRect();
      if (w > 0 && h > 0) {
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        riveRef.current.resizeDrawingSurfaceToCanvas();
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      try { riveRef.current?.cleanup(); } catch (_) {}
    };
  }, [src, artboard, stateMachines?.join(",")]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          // KRITIK: canvas'ın native pointer events alması için
          pointerEvents: "auto",
          touchAction: "none",
        }}
      />
    </div>
  );
}
