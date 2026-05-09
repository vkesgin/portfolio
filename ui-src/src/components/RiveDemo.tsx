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

  // ViewModel refs (cursor-follow / xPos/yPos)
  const vmX = useRef<any>(null);
  const vmY = useRef<any>(null);

  // SM Input refs
  const hoverBooleans = useRef<any[]>([]);
  const clickTriggers = useRef<any[]>([]);
  const xNumbers = useRef<any[]>([]);
  const yNumbers = useRef<any[]>([]);

  const cfg: any = { src, autoplay: true };
  if (artboard) cfg.artboard = artboard;
  if (stateMachines?.length) cfg.stateMachines = stateMachines;

  const { rive, RiveComponent } = useRive({
    ...cfg,
    onLoad: () => {
      if (!rive) return;
      vmX.current = null; vmY.current = null;
      hoverBooleans.current = []; clickTriggers.current = [];
      xNumbers.current = []; yNumbers.current = [];

      // ViewModel data-binding (kedi / cursor-follow için)
      try {
        const vmi = (rive as any).viewModelInstance;
        if (vmi) {
          const xp = vmi.number?.("xPos");
          const yp = vmi.number?.("yPos");
          if (xp) { xp.value = 50; vmX.current = xp; }
          if (yp) { yp.value = 50; vmY.current = yp; }
        }
      } catch (_) {}

      // SM Input'larını tara
      try {
        const sms = (stateMachines?.length ? stateMachines : rive.stateMachineNames) ?? [];
        for (const sm of sms) {
          for (const inp of (rive.stateMachineInputs(sm) ?? [])) {
            const n = inp.name.toLowerCase();
            if (inp.type === StateMachineInputType.Trigger) {
              clickTriggers.current.push(inp);
            } else if (inp.type === StateMachineInputType.Boolean) {
              if (n.includes("hover") || n.includes("over")) hoverBooleans.current.push(inp);
              else if (n.includes("press") || n.includes("click") || n.includes("down")) clickTriggers.current.push(inp);
            } else if (inp.type === StateMachineInputType.Number) {
              if (n === "x" || n === "xpos" || n.endsWith("_x")) xNumbers.current.push(inp);
              if (n === "y" || n === "ypos" || n.endsWith("_y")) yNumbers.current.push(inp);
            }
          }
        }
      } catch (_) {}
    },
  });

  // Global mouse tracking (cursor-follow animasyonları için)
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

  // Rive'ın dahili pointer listener'larına (On Pointer Down) native event iletimine garanti et
  useEffect(() => {
    if (!rive || !containerRef.current) return;
    const container = containerRef.current;

    const onPointerDown = (e: PointerEvent) => {
      // Rive canvas'ını bul ve doğrudan native pointer event gönder
      const canvas = container.querySelector("canvas");
      if (canvas && e.target !== canvas) {
        const rect = canvas.getBoundingClientRect();
        // Rive canvas'ının kendi listener'ını tetikle — native event zaten canvas'a geliyor
        // ama eğer div tıklandıysa canvas'a ilet
        canvas.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: false,
          cancelable: true,
          clientX: e.clientX,
          clientY: e.clientY,
          pointerId: e.pointerId,
          pointerType: e.pointerType,
        }));
      }

      // JS input trigger'larını da çalıştır (Trigger/Boolean SM input'ları için)
      clickTriggers.current.forEach(t => {
        try { typeof t.fire === "function" ? t.fire() : (t.value = true); } catch (_) {}
      });
    };

    container.addEventListener("pointerdown", onPointerDown, { capture: false });
    return () => container.removeEventListener("pointerdown", onPointerDown);
  }, [rive]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center cursor-pointer"
      onMouseEnter={() => hoverBooleans.current.forEach(i => { i.value = true; })}
      onMouseLeave={() => hoverBooleans.current.forEach(i => { i.value = false; })}
    >
      {/*
        RiveComponent canvas'ı pointer event'leri doğrudan alır.
        Rive runtime, bumpy SM içindeki "On Pointer Down" listenerını
        canvas element'ine register eder → tıklayınca zıplar.
      */}
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
