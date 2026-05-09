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
    // Bu iki ayar native hover için kritik:
    // 1. Canvas'ı container boyutuna eşitle (ResizeObserver ile)
    // 2. Rive'ın iç koordinat sistemi CSS boyutuyla senkron kalır
    shouldResizeCanvasToContainer: true,
    // Layout'u container'a otomatik uyarla
    useDevicePixelRatio: true,
  };
  if (artboard) cfg.artboard = artboard;
  if (stateMachines?.length) cfg.stateMachines = stateMachines;

  const { rive, RiveComponent } = useRive(cfg);

  const allInputs = useMemo(() => {
    if (!rive) return [];
    const sms = (stateMachines?.length ? stateMachines : rive.stateMachineNames) ?? [];
    const inputs: any[] = [];
    for (const sm of sms) {
      try { inputs.push(...(rive.stateMachineInputs(sm) ?? [])); } catch (_) {}
    }
    return inputs;
  }, [rive]);

  const triggerInputs = useMemo(
    () => allInputs.filter((i) => i.type === StateMachineInputType.Trigger),
    [allInputs]
  );

  useEffect(() => {
    hoverBooleans.current = allInputs.filter((i) => {
      const n = i.name.toLowerCase();
      return i.type === StateMachineInputType.Boolean &&
        (n.includes("hover") || n.includes("over") || n.includes("active") || n.includes("pressed"));
    });
    xNumbers.current = allInputs.filter((i) => {
      if (i.type !== StateMachineInputType.Number) return false;
      const n = i.name.toLowerCase();
      return n === "x" || n.includes("xpos") || n.endsWith("_x") || n.includes("mousex");
    });
    yNumbers.current = allInputs.filter((i) => {
      if (i.type !== StateMachineInputType.Number) return false;
      const n = i.name.toLowerCase();
      return n === "y" || n.includes("ypos") || n.endsWith("_y") || n.includes("mousey");
    });
  }, [allInputs]);

  // Cursor-follow (number input'lar)
  useEffect(() => {
    if (!xNumbers.current.length && !yNumbers.current.length) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1)) * 100;
      const y = Math.max(0, Math.min((e.clientY - rect.top) / rect.height, 1)) * 100;
      xNumbers.current.forEach((i) => { i.value = x; });
      yNumbers.current.forEach((i) => { i.value = y; });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [rive]);

  const handleClick = () => {
    triggerInputs.forEach((t) => { try { t.fire(); } catch (_) {} });
  };

  // Boolean hover için explicit set — native hover Rive'ın kendi pointer listener'ı halleder
  const handlePointerEnter = () => hoverBooleans.current.forEach((i) => { i.value = true; });
  const handlePointerLeave = () => hoverBooleans.current.forEach((i) => { i.value = false; });

  return (
    <div
      ref={containerRef}
      // position:relative + w-full h-full → RiveObserver'ın doğru bounding box alması için şart
      className="relative w-full h-full cursor-pointer"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handleClick}
    >
      {/*
        absolute inset-0 → canvas tam olarak container'ı kaplar.
        display:block → inline white-space sorununu önler.
        pointer-events:all → Rive'ın kendi pointer listener'ları canvas'a ulaşır
                              (bu sayede native hover tam çalışır).
      */}
      <RiveComponent
        className="absolute inset-0 w-full h-full"
        style={{ display: "block", pointerEvents: "all" }}
      />
    </div>
  );
}
