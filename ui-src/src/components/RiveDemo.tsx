"use client";

import { useRive } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
}

export default function RiveDemo({ src }: RiveDemoProps) {
  const { rive, RiveComponent } = useRive({
    src: src,
    autoplay: true,
    onLoad: () => {
      if (rive) {
        // Rive dosyasındaki tüm "State Machine"leri (İnteraktif yapıları) otomatik başlat
        const stateMachines = rive.stateMachineNames;
        if (stateMachines && stateMachines.length > 0) {
          stateMachines.forEach(sm => rive.play(sm));
        } else {
          rive.play(); // Sadece standart animasyon varsa onu başlat
        }
      }
    }
  });

  return (
    <div className="w-full h-full flex items-center justify-center">
      <RiveComponent className="w-full h-full cursor-pointer" />
    </div>
  );
}
