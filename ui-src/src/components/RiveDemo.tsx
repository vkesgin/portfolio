"use client";

import { useState, useEffect, useCallback } from "react";
import { useRive, Layout, Fit, Alignment } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

/**
 * riveviewer.com ile birebir aynı pattern:
 * - @rive-app/react-canvas
 * - useRive → RiveComponent
 * - artboard + stateMachines parametreleri
 *
 * Ek: DB'de SM/artboard bilgisi eksikse, Rive runtime'dan
 * otomatik tespit edip key-based remount ile SM'li başlatır.
 */
export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const propSM = stateMachines?.[0] || "";
  const [resolvedSM, setResolvedSM] = useState(propSM);
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    if (propSM) setResolvedSM(propSM);
  }, [propSM]);

  const handleDetected = useCallback((name: string) => {
    if (!resolvedSM && name) {
      console.log("[RiveDemo] SM auto-detected:", name);
      setResolvedSM(name);
      setMountKey(k => k + 1);
    }
  }, [resolvedSM]);

  return (
    <RiveInner
      key={`${src}-${resolvedSM}-${mountKey}`}
      src={src}
      artboard={artboard}
      sm={resolvedSM}
      onDetect={!resolvedSM ? handleDetected : undefined}
    />
  );
}

function RiveInner({
  src,
  artboard,
  sm,
  onDetect,
}: {
  src: string;
  artboard?: string;
  sm: string;
  onDetect?: (name: string) => void;
}) {
  const { rive, RiveComponent } = useRive({
    src,
    artboard: artboard || undefined,
    stateMachines: sm || undefined,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  // DB'de SM yoksa runtime'dan tespit et
  useEffect(() => {
    if (!rive || sm || !onDetect) return;
    const t = setTimeout(() => {
      try {
        const names = rive.stateMachineNames;
        if (names?.length) onDetect(names[0]);
      } catch (_) {}
    }, 300);
    return () => clearTimeout(t);
  }, [rive, sm, onDetect]);

  return (
    <RiveComponent
      style={{
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  );
}
