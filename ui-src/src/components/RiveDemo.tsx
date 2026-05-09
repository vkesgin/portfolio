"use client";

import { useEffect, useRef } from "react";
import { useRive, StateMachineInputType } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vmX = useRef<any>(null);
  const vmY = useRef<any>(null);
  const hoverBooleans = useRef<any[]>([]);
  const clickTriggers = useRef<any[]>([]);
  const xNumbers = useRef<any[]>([]);
  const yNumbers = useRef<any[]>([]);

  const cfg: any = { src, autoplay: true };
  if (artboard) cfg.artboard = artboard;
  if (stateMachines?.length) cfg.stateMachines = stateMachines;

  const { rive, RiveComponent } = useRive(cfg);

  // rive nesnesi hazır olduğunda SM input'larını tara
  // onLoad closure'u rive=null yakaladığı için useEffect kullanıyoruz
  useEffect(() => {
    if (!rive) return;

    vmX.current = null; vmY.current = null;
    hoverBooleans.current = []; clickTriggers.current = [];
    xNumbers.current = []; yNumbers.current = [];

    // ViewModel data-binding (cursor-follow için)
    try {
      const vmi = (rive as any).viewModelInstance;
      if (vmi) {
        const xp = vmi.number?.("xPos");
        const yp = vmi.number?.("yPos");
        if (xp) { xp.value = 50; vmX.current = xp; }
        if (yp) { yp.value = 50; vmY.current = yp; }
      }
    } catch (_) {}

    // SM Input'larını tara — tüm SM'leri tara (parametre yoksa tamamını)
    try {
      const sms = (stateMachines?.length ? stateMachines : rive.stateMachineNames) ?? [];
      for (const sm of sms) {
        const inputs = rive.stateMachineInputs(sm) ?? [];
        for (const inp of inputs) {
          const n = inp.name.toLowerCase();
          if (inp.type === StateMachineInputType.Trigger) {
            // Tüm trigger'ları tıklama olarak ekle (bumpy, jump, bounce vb.)
            clickTriggers.current.push(inp);
          } else if (inp.type === StateMachineInputType.Boolean) {
            if (n.includes("hover") || n.includes("over")) {
              hoverBooleans.current.push(inp);
            } else if (
              n.includes("press") || n.includes("click") ||
              n.includes("down") || n.includes("bump") ||
              n.includes("jump") || n.includes("bounce")
            ) {
              clickTriggers.current.push(inp);
            }
          } else if (inp.type === StateMachineInputType.Number) {
            const isX = n === "x" || n === "xpos" || n.endsWith("_x");
            const isY = n === "y" || n === "ypos" || n.endsWith("_y");
            if (isX) xNumbers.current.push(inp);
            if (isY) yNumbers.current.push(inp);
          }
        }
      }
    } catch (_) {}
  }, [rive]);

  // Mouse takibi (cursor-follow animasyonları için)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!vmX.current && !vmY.current && !xNumbers.current.length && !yNumbers.current.length) return;
      const rect = containerRef.current.getBoundingClientRect();
      const xVal = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1)) * 100;
      const yVal = Math.max(0, Math.min((e.clientY - rect.top) / rect.height, 1)) * 100;
      if (vmX.current) vmX.current.value = xVal;
      if (vmY.current) vmY.current.value = yVal;
      xNumbers.current.forEach(i => { i.value = xVal; });
      yNumbers.current.forEach(i => { i.value = yVal; });
    };
    const onLeave = () => {
      if (vmX.current) vmX.current.value = 50;
      if (vmY.current) vmY.current.value = 50;
      xNumbers.current.forEach(i => { i.value = 50; });
      yNumbers.current.forEach(i => { i.value = 50; });
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, [rive]);

  // JS trigger'ları (explicit input olan SM'ler için)
  const handleClick = () => {
    clickTriggers.current.forEach(t => {
      try { typeof t.fire === "function" ? t.fire() : (t.value = true); } catch (_) {}
    });
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center cursor-pointer"
      onMouseEnter={() => hoverBooleans.current.forEach(i => { i.value = true; })}
      onMouseLeave={() => hoverBooleans.current.forEach(i => { i.value = false; })}
      onClick={handleClick}
    >
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
