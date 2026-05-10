"use client";

import { useState, useEffect } from "react";
import { useRive, Layout, Fit, Alignment } from "@rive-app/react-webgl2";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

/**
 * riveviewer.com pattern'i + otomatik SM tespiti:
 *
 * - @rive-app/react-webgl2 (WebGL2 renderer — tam Listener desteği)
 * - RiveComponent (kendi canvas'ını oluşturur, pointer event routing kendi yapar)
 *
 * Akış:
 * 1. Props'tan SM geliyorsa → direkt kullan (normal mod)
 * 2. SM boşsa → Rive'ı SM'siz yükle, stateMachineNames'den SM adını al
 * 3. SM bulunduğunda → key prop ile componenti komple yeniden mount et (SM ile)
 * 4. Bu sayede useRive hook'u SM parametresiyle sıfırdan başlatılır
 *
 * Neden key trick?
 * useRive hook'u stateMachines parametresini sadece ilk mount'ta kullanır.
 * Sonradan değiştirmek etkisizdir. key değişimi React'e "bunu yeni component
 * olarak mount et" der → useRive temiz bir şekilde SM ile başlar.
 */
export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const propSM = stateMachines?.[0] || "";
  const [resolvedSM, setResolvedSM] = useState(propSM);
  const [mountKey, setMountKey] = useState(0);

  // Props değişirse güncelle
  useEffect(() => {
    if (propSM) {
      setResolvedSM(propSM);
    }
  }, [propSM]);

  const handleSMDetected = (smName: string) => {
    if (!resolvedSM && smName) {
      console.log("[RiveDemo] SM otomatik tespit:", smName);
      setResolvedSM(smName);
      setMountKey((k) => k + 1); // Zorla yeniden mount
    }
  };

  return (
    <RiveCanvas
      key={`${src}-${resolvedSM}-${mountKey}`}
      src={src}
      artboard={artboard}
      sm={resolvedSM}
      onSMDetected={!resolvedSM ? handleSMDetected : undefined}
    />
  );
}

function RiveCanvas({
  src,
  artboard,
  sm,
  onSMDetected,
}: {
  src: string;
  artboard?: string;
  sm: string;
  onSMDetected?: (name: string) => void;
}) {
  const { rive, RiveComponent } = useRive({
    src,
    artboard: artboard || undefined,
    stateMachines: sm || undefined,
    autoplay: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

  // SM yoksa ve onSMDetected callback'i varsa, runtime'dan SM bul
  useEffect(() => {
    if (!rive || sm || !onSMDetected) return;

    const timer = setTimeout(() => {
      try {
        const names = rive.stateMachineNames;
        if (names && names.length > 0) {
          onSMDetected(names[0]);
        }
      } catch (_) {}
    }, 200);

    return () => clearTimeout(timer);
  }, [rive, sm, onSMDetected]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <RiveComponent
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
        }}
      />
    </div>
  );
}
