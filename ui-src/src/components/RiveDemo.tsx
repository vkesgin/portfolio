"use client";

import { useRive } from "@rive-app/react-canvas";

interface RiveDemoProps {
  src: string;
}

export default function RiveDemo({ src }: RiveDemoProps) {
  const { RiveComponent } = useRive({
    src: src,
    autoplay: true,
  });

  return (
    <div className="w-full h-full flex items-center justify-center">
      <RiveComponent className="w-full h-full" />
    </div>
  );
}
