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

  const cfg: any = { src, autoplay: true };
  if (artboard) cfg.artboard = artboard;
  if (stateMachines?.length) cfg.stateMachines = stateMachines;

  const { rive, RiveComponent } = useRive(cfg);

  // useMemo ile SM inputlarını al — rive hazır olunca yeniden hesaplanır (RiveViewer pattern)
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

  // Trigger inputları — tüm trigger'lar tıklamada ateşlenir (bump, fire, vb.)
  const triggerInputs = useMemo(
    () => allInputs.filter((i) => i.type === StateMachineInputType.Trigger),
    [allInputs]
  );

  // Hover ve number inputlar için ref senkronizasyonu
  useEffect(() => {
    hoverBooleans.current = allInputs.filter((i) => {
      const n = i.name.toLowerCase();
      return (
        i.type === StateMachineInputType.Boolean &&
        (n.includes("hover") || n.includes("over"))
      );
    });
    xNumbers.current = allInputs.filter((i) => {
      if (i.type !== StateMachineInputType.Number) return false;
      const n = i.name.toLowerCase();
      return n === "x" || n === "xpos" || n.endsWith("_x");
    });
    yNumbers.current = allInputs.filter((i) => {
      if (i.type !== StateMachineInputType.Number) return false;
      const n = i.name.toLowerCase();
      return n === "y" || n === "ypos" || n.endsWith("_y");
    });
  }, [allInputs]);

  // ViewModel cursor takibi (xPos/yPos destekleyen animasyonlar için)
  useEffect(() => {
    if (!rive) return;
    try {
      const vmi = (rive as any).viewModelInstance;
      if (vmi) {
        const xp = vmi.number?.("xPos");
        const yp = vmi.number?.("yPos");
        if (xp) xp.value = 50;
        if (yp) yp.value = 50;
      }
    } catch (_) {}
  }, [rive]);

  // Mouse hareketi (number input'lu cursor-follow animasyonları için)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!xNumbers.current.length && !yNumbers.current.length) return;
      const rect = containerRef.current.getBoundingClientRect();
      const xVal = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1)) * 100;
      const yVal = Math.max(0, Math.min((e.clientY - rect.top) / rect.height, 1)) * 100;
      xNumbers.current.forEach((i) => { i.value = xVal; });
      yNumbers.current.forEach((i) => { i.value = yVal; });
    };
    const onLeave = () => {
      xNumbers.current.forEach((i) => { i.value = 50; });
      yNumbers.current.forEach((i) => { i.value = 50; });
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [rive]);

  // Tıklamada tüm trigger inputları ateşle (bump → .fire())
  const handleClick = () => {
    triggerInputs.forEach((t) => {
      try { t.fire(); } catch (_) {}
    });
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center cursor-pointer"
      onMouseEnter={() => hoverBooleans.current.forEach((i) => { i.value = true; })}
      onMouseLeave={() => hoverBooleans.current.forEach((i) => { i.value = false; })}
      onClick={handleClick}
    >
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
