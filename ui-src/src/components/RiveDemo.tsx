"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useRive, StateMachineInputType } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });

  // ResizeObserver ile container boyutunu gerçek zamanlı takip et
  // Bu olmadan canvas daima 0×0 kalıyor
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setDims({ w: Math.round(width), h: Math.round(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cfg: any = {
    src,
    autoplay: true,
    // shouldResizeCanvasToContainer çalışması için canvas'ın parent'ı gerçek px boyutuna sahip olmalı
    shouldResizeCanvasToContainer: true,
  };
  if (artboard) cfg.artboard = artboard;
  if (stateMachines?.length) {
    cfg.stateMachines = stateMachines.length === 1 ? stateMachines[0] : stateMachines;
  }

  const { rive, RiveComponent } = useRive(cfg);

  // Klasik SM trigger inputları (bump gibi)
  const triggerInputs = useMemo(() => {
    if (!rive) return [];
    const sms = stateMachines?.length ? stateMachines : (rive.stateMachineNames ?? []);
    const out: any[] = [];
    for (const sm of sms) {
      try {
        const inputs = rive.stateMachineInputs(sm) ?? [];
        out.push(...inputs.filter((i: any) => i.type === StateMachineInputType.Trigger));
      } catch (_) {}
    }
    return out;
  }, [rive]);

  // ViewModel trigger — bubble button gibi dosyalar için (stateMachineInputs boş döner)
  const fireViewModelTrigger = () => {
    if (!rive) return;
    try {
      // @ts-ignore — ViewModel API v4.x+
      const vmi = rive.viewModelInstance ?? rive.getViewModelInstance?.();
      if (vmi) {
        // "Button Trig" veya benzeri isimli trigger'ı ara
        const names = ["Button Trig", "Trig", "trigger", "click", "Click", "Press"];
        for (const n of names) {
          try {
            const t = vmi.trigger?.(n) ?? vmi.getTrigger?.(n);
            if (t) { t.fire?.(); return; }
          } catch (_) {}
        }
      }
    } catch (_) {}
  };

  const handleClick = () => {
    // Önce klasik SM trigger dene
    if (triggerInputs.length > 0) {
      triggerInputs.forEach((t) => { try { t.fire(); } catch (_) {} });
    } else {
      // ViewModel trigger dene
      fireViewModelTrigger();
    }
  };

  // canvas boyutu 0 iken render etme — zaten göremezsin, pointer da çalışmaz
  const ready = dims.w > 0 && dims.h > 0;

  return (
    /*
     * Bu div sayfanın layout'undan gerçek boyutunu alır (absolute+inset ile).
     * ResizeObserver bu div'i izler ve dims'i günceller.
     * Sadece dims > 0 olduğunda canvas render edilir → canvas her zaman doğru boyutta.
     */
    <div
      ref={wrapRef}
      className="w-full h-full"
      style={{ position: "relative", cursor: "default" }}
      onClick={handleClick}
    >
      {ready && (
        /*
         * Canvas'a EXACT pixel boyutu ver.
         * shouldResizeCanvasToContainer bu sayede doğru çalışır.
         * pointer-events: all → Rive'ın native listener'ları (hover, click) canvas'a ulaşır.
         */
        <RiveComponent
          style={{
            display: "block",
            width: `${dims.w}px`,
            height: `${dims.h}px`,
            pointerEvents: "all",
          }}
        />
      )}
    </div>
  );
}
