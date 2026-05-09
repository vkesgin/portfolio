"use client";

import { useRive, StateMachineInputType } from "@rive-app/react-canvas";
import { useEffect, useRef } from "react";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachine?: string;
}

export default function RiveDemo({ src, artboard, stateMachine }: RiveDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // === ViewModel (Data Binding) props — for cat-style xPos/yPos cursor tracking ===
  const vmXProp = useRef<any>(null);
  const vmYProp = useRef<any>(null);

  // === Old State Machine Input refs — for hover booleans ===
  const hoverInputs = useRef<any[]>([]);

  const riveConfig: any = {
    src,
    autoplay: true,
    autoBind: true, // Enables new Data Binding / ViewModel API automatically
  };
  if (artboard)     riveConfig.artboard      = artboard;
  if (stateMachine) riveConfig.stateMachines = stateMachine;

  const { rive, RiveComponent } = useRive({
    ...riveConfig,
    onLoad: () => {
      if (!rive) return;

      // ── APPROACH 1: New Data Binding / ViewModel API (cat, eyes, etc.) ──────
      // Checks for xPos / yPos ViewModel properties and maps cursor to them.
      try {
        const vmi = (rive as any).viewModelInstance;
        if (vmi) {
          const xProp = vmi.number("xPos");
          const yProp = vmi.number("yPos");
          if (xProp) { xProp.value = 50; vmXProp.current = xProp; }
          if (yProp) { yProp.value = 50; vmYProp.current = yProp; }
          console.log("[RiveDemo] ViewModel found. xPos/yPos bound:", !!xProp, !!yProp);
        }
      } catch (e) {
        // File may not use Data Binding — that's fine
      }

      // ── APPROACH 2: Old State Machine Inputs API (hover booleans) ────────────
      // NOTE: Trigger/click inputs are NOT bound here intentionally.
      // Rive's own internal listeners (e.g. bumpy/vehicles "on click" listeners)
      // handle pointer events directly on the canvas. We must NOT set
      // pointer-events-none on RiveComponent for these to work.
      try {
        const smNames = rive.stateMachineNames;
        if (smNames && smNames.length > 0) {
          smNames.forEach(sm => {
            const inputs = rive.stateMachineInputs(sm);
            if (inputs) {
              inputs.forEach(input => {
                const name = input.name.toLowerCase();
                if (
                  input.type === StateMachineInputType.Boolean &&
                  name.includes("hover")
                ) {
                  hoverInputs.current.push(input);
                }
              });
            }
          });
          console.log("[RiveDemo] State machines found:", smNames);
        }
      } catch (e) {
        // File may not have State Machine inputs
      }
    },
  });

  // ── Window-level mouse tracking for ViewModel (cat-style) ──────────────────
  // We listen on the window so the character follows the cursor even when
  // the mouse is outside the canvas element.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!vmXProp.current && !vmYProp.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const clampedY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      const xVal = (clampedX / rect.width) * 100;
      const yVal = (clampedY / rect.height) * 100;

      if (vmXProp.current) vmXProp.current.value = xVal;
      if (vmYProp.current) vmYProp.current.value = yVal;
    };

    const handleMouseLeave = () => {
      // Reset to center when cursor leaves the page
      if (vmXProp.current) vmXProp.current.value = 50;
      if (vmYProp.current) vmYProp.current.value = 50;
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [rive]);

  // ── Hover state machine inputs (old API) ───────────────────────────────────
  const handleMouseEnter = () => {
    hoverInputs.current.forEach(input => { input.value = true; });
  };

  const handleMouseLeave = () => {
    hoverInputs.current.forEach(input => { input.value = false; });
  };

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex items-center justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/*
        CRITICAL: No pointer-events-none here!
        Rive files with internal "On Press / On Click" listeners (like vehicles/bumpy)
        need raw pointer events to reach the canvas. If we block them, clicks do nothing.
      */}
      <RiveComponent className="w-full h-full cursor-pointer" />
    </div>
  );
}
