"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRive, StateMachineInputType } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverBooleans = useRef<any[]>([]);
  const xNumbers = useRef<any[]>([]);
  const yNumbers = useRef<any[]>([]);

  const cfg: any = {
    src,
    autoplay: true,
    // KRITIK: CSS ile scale'lenen canvas'ta Rive'ın hit-test koordinatlarını düzeltir
    // Bu olmadan native hover (pointer events) çalışmaz
    shouldResizeCanvasToContainer: true,
  };
  if (artboard) cfg.artboard = artboard;
  if (stateMachines?.length) cfg.stateMachines = stateMachines;

  const { rive, RiveComponent } = useRive(cfg);

  // useMemo: rive hazır olunca input'ları al (RiveViewer pattern)
  const allInputs = useMemo(() => {
    if (!rive) return [];
    const sms = (stateMachines?.length ? stateMachines : rive.stateMachineNames) ?? [];
    const inputs: any[] = [];
    for (const sm of sms) {
      try {
        const smInputs = rive.stateMachineInputs(sm) ?? [];
        inputs.push(...smInputs);
      } catch (_) {}
    }
    return inputs;
  }, [rive]);

  // Trigger inputları — tıklamada ateşlenir
  const triggerInputs = useMemo(
    () => allInputs.filter((i) => i.type === StateMachineInputType.Trigger),
    [allInputs]
  );

  // Hover/number input'ları ref'e yaz
  useEffect(() => {
    hoverBooleans.current = allInputs.filter((i) => {
      const n = i.name.toLowerCase();
      return (
        i.type === StateMachineInputType.Boolean &&
        (n.includes("hover") || n.includes("over") || n.includes("active"))
      );
    });
    xNumbers.current = allInputs.filter((i) => {
      if (i.type !== StateMachineInputType.Number) return false;
      const n = i.name.toLowerCase();
      return n === "x" || n === "xpos" || n.endsWith("_x") || n.includes("mousex");
    });
    yNumbers.current = allInputs.filter((i) => {
      if (i.type !== StateMachineInputType.Number) return false;
      const n = i.name.toLowerCase();
      return n === "y" || n === "ypos" || n.endsWith("_y") || n.includes("mousey");
    });
  }, [allInputs]);

  // Mouse koordinatı takibi (cursor-follow animasyonlar için)
  useEffect(() => {
    if (!xNumbers.current.length && !yNumbers.current.length) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const xVal = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1)) * 100;
      const yVal = Math.max(0, Math.min((e.clientY - rect.top) / rect.height, 1)) * 100;
      xNumbers.current.forEach((i) => { i.value = xVal; });
      yNumbers.current.forEach((i) => { i.value = yVal; });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [rive]);

  // Tıklamada trigger'ları ateşle
  const handleClick = () => {
    triggerInputs.forEach((t) => {
      try { t.fire(); } catch (_) {}
    });
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full cursor-pointer"
      onMouseEnter={() => hoverBooleans.current.forEach((i) => { i.value = true; })}
      onMouseLeave={() => hoverBooleans.current.forEach((i) => { i.value = false; })}
      onClick={handleClick}
    >
      {/*
        pointerEvents:all → Rive'ın native hover/click listener'larının canvas'a ulaşmasını garantiler.
        shouldResizeCanvasToContainer ile birlikte native hover tam çalışır.
      */}
      <RiveComponent style={{ width: "100%", height: "100%", pointerEvents: "all" }} />
    </div>
  );
}
