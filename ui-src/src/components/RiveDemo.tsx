"use client";

import { useMemo, useRef } from "react";
import { useRive, StateMachineInputType } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const cfg: any = {
    src,
    autoplay: true,
    // Canvas'ı container boyutuna eşitle — koordinat mapping için şart
    shouldResizeCanvasToContainer: true,
  };
  if (artboard) cfg.artboard = artboard;
  // Rive, string veya string[] alır — state machine için tek string daha güvenli
  if (stateMachines?.length) {
    cfg.stateMachines = stateMachines.length === 1 ? stateMachines[0] : stateMachines;
  }

  const { rive, RiveComponent } = useRive(cfg);

  // Sadece trigger input'ları için — native hover'a DOKUNMUYORUZ
  const triggerInputs = useMemo(() => {
    if (!rive) return [];
    const sms = stateMachines?.length ? stateMachines : (rive.stateMachineNames ?? []);
    const triggers: any[] = [];
    for (const sm of sms) {
      try {
        const inputs = rive.stateMachineInputs(sm) ?? [];
        triggers.push(...inputs.filter((i: any) => i.type === StateMachineInputType.Trigger));
      } catch (_) {}
    }
    return triggers;
  }, [rive]);

  const handleClick = () => {
    triggerInputs.forEach((t) => { try { t.fire(); } catch (_) {} });
  };

  return (
    /*
     * KRITIK: Bu div sadece bir boyutlandırma kapsayıcısı.
     * 
     * NEDEN pointer events eklemiyoruz?
     * Bu dosya (bubble button gibi) Rive Editor'de tanımlanmış
     * built-in pointer listener'ları kullanıyor (Button Hover state).
     * Rive runtime, canvas'a gelen NATIVE pointer events ile bunları
     * otomatik tetikler. Wrapper div'e eklenen React event handler'ları
     * bu native event'ların canvas'a ulaşmasını ENGELLEYEBİLİR.
     *
     * Trigger input'ları için onClick kullanıyoruz (bump, fire gibi).
     * ViewModel Listener'lar için hiçbir şey yapmıyoruz — Rive halleder.
     */
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ cursor: triggerInputs.length > 0 ? "pointer" : "default" }}
      onClick={triggerInputs.length > 0 ? handleClick : undefined}
    >
      {/*
        RiveComponent doğrudan canvas'ı render eder.
        pointer-events: all → canvas'ın kendi native event listener'larına
        (pointerenter, pointermove, pointerleave) hiçbir DOM engeli olmadan ulaşmasını sağlar.
        display: block → inline element'in yarattığı alt boşluğu önler.
      */}
      <RiveComponent
        className="w-full h-full"
        style={{ display: "block", pointerEvents: "all" }}
      />
    </div>
  );
}
