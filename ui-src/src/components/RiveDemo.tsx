"use client";

import { useRive, StateMachineInputType } from "@rive-app/react-canvas";
import { useEffect, useRef } from "react";

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
  const clickTriggers = useRef<any[]>([]);
  const hoverBooleans = useRef<any[]>([]);
  const xNumbers = useRef<any[]>([]);
  const yNumbers = useRef<any[]>([]);

  const riveConfig: any = { src, autoplay: true, autoBind: true };
  if (artboard) riveConfig.artboard = artboard;
  if (stateMachines && stateMachines.length > 0) riveConfig.stateMachines = stateMachines;

  const { rive, RiveComponent } = useRive({
    ...riveConfig,
    onLoad: () => {
      if (!rive) return;

      // Reset all
      vmX.current = null; vmY.current = null;
      clickTriggers.current = []; hoverBooleans.current = [];
      xNumbers.current = []; yNumbers.current = [];

      // === API 1: ViewModel / Data Binding (xPos, yPos) ===
      try {
        const vmi = (rive as any).viewModelInstance;
        if (vmi) {
          const xp = vmi.number("xPos");
          const yp = vmi.number("yPos");
          if (xp) { xp.value = 50; vmX.current = xp; }
          if (yp) { yp.value = 50; vmY.current = yp; }
        }
      } catch (_) {}

      // === API 2: SM Inputs (triggers, booleans, numbers) ===
      try {
        const smsToScan = (stateMachines && stateMachines.length > 0)
          ? stateMachines
          : (rive.stateMachineNames ?? []);

        for (const sm of smsToScan) {
          const inputs = rive.stateMachineInputs(sm) ?? [];
          for (const inp of inputs) {
            const n = inp.name.toLowerCase();
            if (inp.type === StateMachineInputType.Trigger) {
              clickTriggers.current.push(inp);
            } else if (inp.type === StateMachineInputType.Boolean) {
              if (n.includes("hover") || n.includes("over") || n.includes("mouse")) {
                hoverBooleans.current.push(inp);
              } else if (n.includes("press") || n.includes("click") || n.includes("tap") || n.includes("down")) {
                clickTriggers.current.push(inp);
              }
            } else if (inp.type === StateMachineInputType.Number) {
              const isX = n === "x" || n === "xpos" || n.endsWith("_x") || n.startsWith("x_");
              const isY = n === "y" || n === "ypos" || n.endsWith("_y") || n.startsWith("y_");
              if (isX) xNumbers.current.push(inp);
              if (isY) yNumbers.current.push(inp);
            }
          }
        }
      } catch (_) {}
    },
  });

  // Global mouse tracking for cursor-follow animations
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const hasVM = vmX.current || vmY.current;
      const hasSM = xNumbers.current.length || yNumbers.current.length;
      if (!hasVM && !hasSM) return;
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const xVal = (Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width) * 100;
      const yVal = (Math.max(0, Math.min(e.clientY - rect.top, rect.height)) / rect.height) * 100;

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

  // Fire JS-side triggers (only for explicit trigger/boolean inputs)
  const handleClick = () => {
    clickTriggers.current.forEach(t => {
      if (typeof t.fire === "function") t.fire();
      else t.value = true;
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
      {/* RiveComponent canvas receives pointer events directly for Rive's internal On Pointer Down listeners */}
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

