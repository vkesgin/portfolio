"use client";

import { useEffect, useRef } from "react";
import { useRive, Layout, Fit, Alignment, StateMachineInputType } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

/**
 * @rive-app/react-canvas kullanır.
 * useRive hook'u:
 *   1. Canvas'ı doğru boyutta başlatır (layout paint sonrası)
 *   2. ViewModel native pointer event'lerini otomatik yakalar
 *      (hover/click için ek React kodu GEREKMİYOR)
 *   3. Trigger input'ları olan animasyonlar için click handler'ı ekler
 */
export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const sm = stateMachines?.[0];
  const containerRef = useRef<HTMLDivElement>(null);

  const { rive, RiveComponent } = useRive({
    src,
    artboard: artboard || undefined,
    stateMachines: sm || undefined,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  // Canvas'ı container boyutuna zorla (RiveComponent mount olduktan sonra)
  useEffect(() => {
    if (!rive) return;
    // Kısa bir delay ile resize — RiveComponent'in canvas'ı DOM'a yazması için
    const timer = setTimeout(() => {
      try { rive.resizeDrawingSurfaceToCanvas(); } catch (_) {}
    }, 50);
    return () => clearTimeout(timer);
  }, [rive]);

  // Container boyutu değişince Rive'ı güncelle
  useEffect(() => {
    if (!rive || !containerRef.current) return;
    const ro = new ResizeObserver(() => {
      try { rive.resizeDrawingSurfaceToCanvas(); } catch (_) {}
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [rive]);

  // Trigger input'ları için click handler (araba/bump gibi dosyalar için)
  useEffect(() => {
    if (!rive || !sm) return;
    let inputs: any[] = [];
    try { inputs = rive.stateMachineInputs(sm) ?? []; } catch (_) { return; }

    // type === 2 = Trigger (@rive-app/react-canvas'ta)
    const triggers = inputs.filter((i: any) => i.type === StateMachineInputType.Trigger);
    if (triggers.length === 0) return;

    // RiveComponent'in canvas'ını bul
    const canvas = containerRef.current?.querySelector("canvas");
    if (!canvas) return;

    const handleClick = () => {
      triggers.forEach((t: any) => { try { t.fire(); } catch (_) {} });
    };
    canvas.addEventListener("pointerdown", handleClick);
    return () => canvas.removeEventListener("pointerdown", handleClick);
  }, [rive, sm]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
    >
      <RiveComponent
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
    </div>
  );
}
