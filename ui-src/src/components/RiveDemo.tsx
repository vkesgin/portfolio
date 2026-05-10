"use client";

import { useState, useEffect, useRef } from "react";
import { useRive, Layout, Fit, Alignment, StateMachineInputType } from "@rive-app/react-webgl2";
import { Rive } from "@rive-app/canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const hasSM = stateMachines && stateMachines.length > 0 && !!stateMachines[0];

  if (hasSM) {
    return <RivePlayer src={src} artboard={artboard} sm={stateMachines![0]} />;
  }

  return <ProbeAndPlay src={src} artboard={artboard} />;
}

function RivePlayer({ src, artboard, sm }: { src: string; artboard?: string; sm: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTriggers = useRef<any[]>([]);
  const hoverInputs = useRef<any[]>([]);
  const xInputs = useRef<any[]>([]);
  const yInputs = useRef<any[]>([]);

  const { rive, RiveComponent } = useRive({
    src,
    artboard: artboard || undefined,
    stateMachines: sm,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    autoBind: true, // WebGL2'de ViewModel Listeners (Bubble Button) için zorunlu!
    onLoad: () => {
      // "Zıplayan Araba" gibi State Machine Input'larıyla çalışanlar için eski 
      // "ultra-smart" event bağlama sistemini geri getiriyoruz.
    }
  });

  useEffect(() => {
    if (rive) {
      // Inputları topla
      const inputs = rive.stateMachineInputs(sm);
      if (inputs) {
        clickTriggers.current = [];
        hoverInputs.current = [];
        xInputs.current = [];
        yInputs.current = [];

        inputs.forEach(input => {
          const name = input.name.toLowerCase();
          if (input.type === StateMachineInputType.Trigger) {
            clickTriggers.current.push(input);
          } else if (input.type === StateMachineInputType.Boolean && (name.includes('click') || name.includes('press'))) {
            clickTriggers.current.push(input);
          } else if (input.type === StateMachineInputType.Boolean && name.includes('hover')) {
            hoverInputs.current.push(input);
          } else if (input.type === StateMachineInputType.Number) {
            if (name.includes('x')) xInputs.current.push(input);
            if (name.includes('y')) yInputs.current.push(input);
          }
        });
      }
    }
  }, [rive, sm]);

  const handleClick = () => {
    clickTriggers.current.forEach(trigger => {
      if (trigger.fire) trigger.fire();
      else trigger.value = true;
    });
  };

  const handleMouseEnter = () => {
    hoverInputs.current.forEach(input => { input.value = true; });
  };

  const handleMouseLeave = () => {
    hoverInputs.current.forEach(input => { input.value = false; });
    xInputs.current.forEach(input => { input.value = 50; });
    yInputs.current.forEach(input => { input.value = 50; });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xPercent = (x / rect.width) * 100;
    const yPercent = (y / rect.height) * 100;
    
    xInputs.current.forEach(input => { input.value = xPercent; });
    yInputs.current.forEach(input => { input.value = yPercent; });
  };

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", cursor: clickTriggers.current.length > 0 ? "pointer" : "default" }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      {/* NOT pointer-events-none! Native listener'lar (Bubble) tıklamaları yakalayabilmeli */}
      <RiveComponent style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

function ProbeAndPlay({ src, artboard }: { src: string; artboard?: string }) {
  const [detected, setDetected] = useState<{ sm: string; ab: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const probing = useRef(false);

  useEffect(() => {
    if (probing.current) return;
    probing.current = true;

    (async () => {
      try {
        const resp = await fetch(src);
        if (!resp.ok) { setFailed(true); return; }
        const buffer = await resp.arrayBuffer();

        const cv = document.createElement("canvas");
        cv.width = 10;
        cv.height = 10;

        const probe = new Rive({
          buffer,
          canvas: cv,
          autoplay: false,
          onLoad: () => {
            try {
              const smNames = probe.stateMachineNames || [];
              const artboards = (probe as any).artboardNames || [];
              const abName = artboard || (artboards.length > 0 ? artboards[0] : "");
              console.log("[RiveDemo] Probe - SM:", smNames, "Artboard:", abName);

              if (smNames.length > 0) {
                setDetected({ sm: smNames[0], ab: abName });
              } else {
                setFailed(true);
              }
            } catch (_) { setFailed(true); }
            try { probe.cleanup(); } catch (_) {}
          },
          onLoadError: () => setFailed(true),
        });
      } catch (_) { setFailed(true); }
    })();
  }, [src, artboard]);

  if (detected) {
    return <RivePlayer src={src} artboard={detected.ab || undefined} sm={detected.sm} />;
  }

  if (failed) {
    return <FallbackPlayer src={src} artboard={artboard} />;
  }

  return <div style={{ width: "100%", height: "100%", background: "transparent" }} />;
}

function FallbackPlayer({ src, artboard }: { src: string; artboard?: string }) {
  const { RiveComponent } = useRive({
    src,
    artboard: artboard || undefined,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
    autoBind: true,
  });

  return (
    <RiveComponent
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
