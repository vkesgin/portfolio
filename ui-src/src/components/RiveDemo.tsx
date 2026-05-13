"use client";

import { useState, useEffect, useRef } from "react";
import {
  useRive,
  useViewModel,
  useViewModelInstance,
  useViewModelInstanceString,
  Layout, Fit, Alignment, StateMachineInputType
} from "@rive-app/react-webgl2";
import { Rive } from "@rive-app/canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
  label?: string; // ← ViewModel "label" property'si üzerinden metin değiştirir
}

export default function RiveDemo({ src, artboard, stateMachines, label }: RiveDemoProps) {
  const hasSM = stateMachines && stateMachines.length > 0 && !!stateMachines[0];

  if (hasSM) {
    return <RivePlayer src={src} artboard={artboard} sm={stateMachines![0]} label={label} />;
  }

  return <ProbeAndPlay src={src} artboard={artboard} label={label} />;
}

function RivePlayer({ src, artboard, sm, label }: { src: string; artboard?: string; sm: string; label?: string }) {
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
  });

  // ─── ViewModel Data Binding (Profesyonel metin değiştirme) ────
  const viewModel = useViewModel(rive);
  const viewModelInstance = useViewModelInstance(viewModel, { rive });
  const labelProp = useViewModelInstanceString("label", viewModelInstance);

  // Label değişince ViewModel üzerinden güncelle
  useEffect(() => {
    if (label && labelProp?.setValue) {
      labelProp.setValue(label);
    }
  }, [label, labelProp]);

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

      // Eski yöntem fallback: Text Run ile de dene (ViewModel yoksa belki çalışır)
      if (label) {
        const runNames = ["ButtonText", "label", "Label", "Text", "Title", "ButtonMetni", "TestMest", "Run"];
        runNames.forEach(name => {
          try { rive.setTextRunValue(name, label); } catch (_) {}
        });
      }
    }
  }, [rive, sm, label]);

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

function ProbeAndPlay({ src, artboard, label }: { src: string; artboard?: string; label?: string }) {
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
    return <RivePlayer src={src} artboard={detected.ab || undefined} sm={detected.sm} label={label} />;
  }

  if (failed) {
    return <FallbackPlayer src={src} artboard={artboard} label={label} />;
  }

  return <div style={{ width: "100%", height: "100%", background: "transparent" }} />;
}

function FallbackPlayer({ src, artboard, label }: { src: string; artboard?: string; label?: string }) {
  const { rive, RiveComponent } = useRive({
    src,
    artboard: artboard || undefined,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  // ViewModel Data Binding
  const viewModel = useViewModel(rive);
  const viewModelInstance = useViewModelInstance(viewModel, { rive });
  const labelProp = useViewModelInstanceString("label", viewModelInstance);

  useEffect(() => {
    if (label && labelProp?.setValue) {
      labelProp.setValue(label);
    }
  }, [label, labelProp]);

  useEffect(() => {
    if (rive && label) {
      const runNames = ["ButtonText", "label", "Label", "Text", "Title", "ButtonMetni", "TestMest", "Run"];
      runNames.forEach(name => {
        try { rive.setTextRunValue(name, label); } catch (_) {}
      });
    }
  }, [rive, label]);

  return (
    <RiveComponent
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
