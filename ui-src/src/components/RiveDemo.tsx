"use client";

import { useRive, Layout, Fit, Alignment } from "@rive-app/react-webgl2";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachines?: string[];
}

/**
 * riveviewer.com ile aynı pattern:
 * - @rive-app/react-webgl2 (WebGL2 renderer — tam ViewModel + Listener desteği)
 * - RiveComponent (kendi canvas'ını oluşturur, pointer event routing'ini kendi yapar)
 * - autoBind: true (ViewModel data binding otomatik)
 *
 * ÖNEMLİ:
 * - RiveComponent kendi <canvas>'ını DOM'a ekler ve tüm pointer event'leri
 *   (mousemove, mouseenter, mouseleave, pointerdown, pointerup)
 *   DOĞRUDAN Rive runtime'ına yönlendirir.
 * - Bu sayede .riv dosyasındaki Listener'lar (Pointer Enter, Pointer Exit, Click)
 *   otomatik çalışır — EK KOD GEREKMİYOR.
 * - setCanvasRef/setContainerRef kullanmıyoruz çünkü RiveComponent bunu
 *   kendi iç yapısında zaten doğru zamanlamayla yapıyor.
 */
export default function RiveDemo({ src, artboard, stateMachines }: RiveDemoProps) {
  const sm = stateMachines?.[0];

  const { RiveComponent } = useRive({
    src,
    artboard: artboard || undefined,
    stateMachines: sm || undefined,
    autoplay: true,
    autoBind: true,
    layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
  });

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
