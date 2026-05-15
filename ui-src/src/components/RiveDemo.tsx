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
import { applyTextPatch, findOrigTextInBinary } from "../utils/rivePatch";

// ═══════════════════════════════════════════════════════════════════════
// usePatchedRiveSrc — .riv dosyasını bellekte patch'ler
// Returns { src, loading } — loading=true iken RivePlayer render edilmemeli
// çünkü useRive sadece ilk src'yi yükler, sonradan değişen src'yi görmez.
// ═══════════════════════════════════════════════════════════════════════
function usePatchedRiveSrc(src: string, labels?: Record<string, string>, fallbackDefaults?: Record<string, string>) {
  const hasLabels = labels && Object.keys(labels).length > 0;
  const [state, setState] = useState<{ patchedSrc: string; loading: boolean }>({
    patchedSrc: src,
    loading: !!hasLabels, // labels varsa loading başla
  });

  const labelsStr = labels ? JSON.stringify(labels) : "";

  useEffect(() => {
    if (!labelsStr || labelsStr === "{}") {
      setState({ patchedSrc: src, loading: false });
      return;
    }

    // Labels var → loading=true, patch bitene kadar useRive başlatılmayacak
    setState(prev => ({ ...prev, loading: true }));

    const parsedLabels = JSON.parse(labelsStr);
    let isMounted = true;
    let urlToRevoke = "";

    async function patchRive() {
      try {
        const resp = await fetch(src);
        const buf = await resp.arrayBuffer();
        let result: Uint8Array = new Uint8Array(buf);
        let patchedCount = 0;

        for (const [propName, value] of Object.entries(parsedLabels) as [string, string][]) {
          if (!value) continue;

          let origText = fallbackDefaults?.[propName];
          if (!origText && (propName === 'label' || propName === 'label ')) {
            origText = fallbackDefaults?.['label'] || fallbackDefaults?.['label '];
          }
          if (!origText) {
            origText = findOrigTextInBinary(result, propName);
          }



          if (origText && origText !== value) {
            result = applyTextPatch(result, origText, value);
            patchedCount++;
          } else if (!origText) {
            console.warn(`[RiveDemo] Orig text not found for prop: ${propName}`);
          }
        }

        if (patchedCount > 0 && isMounted) {
          const blob = new Blob([result.buffer as ArrayBuffer], { type: "application/octet-stream" });
          urlToRevoke = URL.createObjectURL(blob);
          setState({ patchedSrc: urlToRevoke, loading: false });
        } else if (isMounted) {
          setState({ patchedSrc: src, loading: false });
        }
      } catch (err) {
        console.error("Rive memory patching failed:", err);
        if (isMounted) setState({ patchedSrc: src, loading: false });
      }
    }

    patchRive();

    return () => {
      isMounted = false;
      if (urlToRevoke) {
        URL.revokeObjectURL(urlToRevoke);
      }
    };
  }, [src, labelsStr]);

  return state;
}

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
  label?: string;                                        // Geriye uyumlu tek label
  labels?: Record<string, string>;                       // Çoklu label desteği
  fallbackDefaults?: Record<string, string>;             // Patch icin orijinal text fallbackleri
  onDefaultLabel?: (label: string) => void;
  onDefaultLabels?: (labels: Record<string, string>) => void;  // Tüm default'ları raporla
  viewModelName?: string;                                // Belirli bir ViewModel adı belirtmek için
}

export default function RiveDemo({ src, artboard, stateMachines, label, labels, fallbackDefaults, onDefaultLabel, onDefaultLabels, viewModelName }: RiveDemoProps) {
  const hasSM = stateMachines && stateMachines.length > 0 && !!stateMachines[0];

  // Geriye uyumlu: tek label'i labels'a merge et
  const mergedLabels = { ...labels, ...(label ? { label: label } : {}) };

  if (hasSM) {
    return <RivePlayerWrapper src={src} artboard={artboard} sm={stateMachines![0]} labels={mergedLabels} fallbackDefaults={fallbackDefaults} onDefaultLabel={onDefaultLabel} onDefaultLabels={onDefaultLabels} viewModelName={viewModelName} />;
  }

  return <ProbeAndPlay src={src} artboard={artboard} labels={mergedLabels} fallbackDefaults={fallbackDefaults} onDefaultLabel={onDefaultLabel} onDefaultLabels={onDefaultLabels} viewModelName={viewModelName} />;
}

// ═══════════════════════════════════════════════════════════════════════
// RivePlayerWrapper — Patch bitene kadar bekler, sonra RivePlayerInner'ı mount eder
// Bu sayede useRive HER ZAMAN doğru (patch'lenmiş) src ile başlar.
// ═══════════════════════════════════════════════════════════════════════
function RivePlayerWrapper(props: { src: string; artboard?: string; sm: string; labels?: Record<string, string>; fallbackDefaults?: Record<string, string>; onDefaultLabel?: (label: string) => void; onDefaultLabels?: (labels: Record<string, string>) => void; viewModelName?: string; }) {
  const { patchedSrc, loading } = usePatchedRiveSrc(props.src, props.labels, props.fallbackDefaults);

  if (loading) {
    return <div style={{ width: "100%", height: "100%", background: "transparent" }} />;
  }

  return <RivePlayerInner {...props} resolvedSrc={patchedSrc} />;
}

function RivePlayerInner({ resolvedSrc, artboard, sm, labels, onDefaultLabel, onDefaultLabels, viewModelName }: { resolvedSrc: string; artboard?: string; sm: string; labels?: Record<string, string>; fallbackDefaults?: Record<string, string>; onDefaultLabel?: (label: string) => void; onDefaultLabels?: (labels: Record<string, string>) => void; viewModelName?: string; src?: string; }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTriggers = useRef<any[]>([]);
  const hoverInputs = useRef<any[]>([]);
  const xInputs = useRef<any[]>([]);
  const yInputs = useRef<any[]>([]);
  const reportedDefault = useRef(false);

  const { rive, RiveComponent } = useRive({
    src: resolvedSrc,
    artboard: artboard || undefined,
    stateMachines: sm,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  // ─── ViewModel Data Binding (geriye uyumlu "label" + "label ") ────
  const viewModel = useViewModel(rive, viewModelName ? { name: viewModelName } : undefined);
  const viewModelInstance = useViewModelInstance(viewModel, { rive });
  const labelProp = useViewModelInstanceString("label", viewModelInstance);
  const labelPropAlt = useViewModelInstanceString("label ", viewModelInstance);
  const activeLabelProp = labelProp?.value ? labelProp : labelPropAlt;

  // Orijinal label'ı raporla (bir kez)
  useEffect(() => {
    if (activeLabelProp?.value && !reportedDefault.current && onDefaultLabel) {
      reportedDefault.current = true;
      onDefaultLabel(activeLabelProp.value);
    }
  }, [activeLabelProp?.value, onDefaultLabel]);

  // Default label'lari raporla
  useEffect(() => {
    if (!viewModelInstance || !onDefaultLabels || reportedDefault.current) return;
    try {
      const inst = viewModelInstance as any;
      const defaults: Record<string, string> = {};
      for (const name of ['label', 'label ']) {
        try {
          const prop = inst?.string?.(name);
          if (prop?.value) defaults[name] = prop.value;
        } catch (_) {}
      }
      if (Object.keys(defaults).length > 0) {
        onDefaultLabels(defaults);
      }
    } catch (_) {}
  }, [viewModelInstance, onDefaultLabels]);

  useEffect(() => {
    if (rive) {
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

function ProbeAndPlay({ src, artboard, labels, fallbackDefaults, onDefaultLabel, onDefaultLabels, viewModelName }: { src: string; artboard?: string; labels?: Record<string, string>; fallbackDefaults?: Record<string, string>; onDefaultLabel?: (label: string) => void; onDefaultLabels?: (labels: Record<string, string>) => void; viewModelName?: string; }) {
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
    return <RivePlayerWrapper src={src} artboard={detected.ab || undefined} sm={detected.sm} labels={labels} fallbackDefaults={fallbackDefaults} onDefaultLabel={onDefaultLabel} onDefaultLabels={onDefaultLabels} viewModelName={viewModelName} />;
  }

  if (failed) {
    return <FallbackPlayer src={src} artboard={artboard} labels={labels} fallbackDefaults={fallbackDefaults} onDefaultLabel={onDefaultLabel} onDefaultLabels={onDefaultLabels} viewModelName={viewModelName} />;
  }

  return <div style={{ width: "100%", height: "100%", background: "transparent" }} />;
}

function FallbackPlayer({ src, artboard, labels, fallbackDefaults, onDefaultLabel, onDefaultLabels, viewModelName }: { src: string; artboard?: string; labels?: Record<string, string>; fallbackDefaults?: Record<string, string>; onDefaultLabel?: (label: string) => void; onDefaultLabels?: (labels: Record<string, string>) => void; viewModelName?: string; }) {
  const reportedDefault = useRef(false);
  const { patchedSrc, loading } = usePatchedRiveSrc(src, labels, fallbackDefaults);

  if (loading) {
    return <div style={{ width: "100%", height: "100%", background: "transparent" }} />;
  }

  return <FallbackPlayerInner resolvedSrc={patchedSrc} artboard={artboard} onDefaultLabel={onDefaultLabel} onDefaultLabels={onDefaultLabels} viewModelName={viewModelName} />;
}

function FallbackPlayerInner({ resolvedSrc, artboard, onDefaultLabel, onDefaultLabels, viewModelName }: { resolvedSrc: string; artboard?: string; onDefaultLabel?: (label: string) => void; onDefaultLabels?: (labels: Record<string, string>) => void; viewModelName?: string; }) {
  const reportedDefault = useRef(false);

  const { rive, RiveComponent } = useRive({
    src: resolvedSrc,
    artboard: artboard || undefined,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  // ViewModel Data Binding
  const viewModel = useViewModel(rive, viewModelName ? { name: viewModelName } : undefined);
  const viewModelInstance = useViewModelInstance(viewModel, { rive });
  const labelProp = useViewModelInstanceString("label", viewModelInstance);
  const labelPropAlt = useViewModelInstanceString("label ", viewModelInstance);
  const activeLabelProp = labelProp?.value ? labelProp : labelPropAlt;

  useEffect(() => {
    if (activeLabelProp?.value && !reportedDefault.current && onDefaultLabel) {
      reportedDefault.current = true;
      onDefaultLabel(activeLabelProp.value);
    }
  }, [activeLabelProp?.value, onDefaultLabel]);

  return (
    <RiveComponent
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
