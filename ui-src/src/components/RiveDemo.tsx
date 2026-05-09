"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useRive, Layout, Fit, Alignment, StateMachineInputType } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Container'ın gerçek piksel boyutunu ölç
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observe = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
    };
    observe(); // hemen bir kez
    const ro = new ResizeObserver(observe);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sm = stateMachines?.length ? stateMachines[0] : undefined;

  const { rive, RiveComponent } = useRive({
    src,
    artboard: artboard || undefined,
    stateMachines: sm,
    autoplay: true,
    // Layout: artboard'u canvas'a tam sığdır, ortalı — KRITIK
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  // Trigger inputları (bump gibi)
  const triggers = useMemo(() => {
    if (!rive || !sm) return [];
    try {
      return (rive.stateMachineInputs(sm) ?? []).filter(
        (i: any) => i.type === StateMachineInputType.Trigger
      );
    } catch { return []; }
  }, [rive]);

  const fireTriggers = () => triggers.forEach((t: any) => { try { t.fire(); } catch { } });

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "relative" }}
      onClick={triggers.length > 0 ? fireTriggers : undefined}
    >
      {size && (
        <RiveComponent
          style={{
            display: "block",
            width: size.w,
            height: size.h,
            // KRITIK: canvas'ın kendi pointer events'ını almasını sağla
            // Rive'ın native listener (hover, click) bunun üzerinden çalışır
            pointerEvents: "all",
          }}
        />
      )}
    </div>
  );
}
