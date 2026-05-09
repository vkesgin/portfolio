"use client";

import { useRive, useStateMachineInput } from "@rive-app/react-canvas";

export default function RiveDemo() {
  // Using a public Rive file for demonstration.
  // In production, you'd use your own .riv files from Cloudflare R2
  const { rive, RiveComponent } = useRive({
    src: "https://cdn.rive.app/animations/vehicles.riv",
    stateMachines: "bumpy",
    autoplay: true,
  });

  const bumpInput = useStateMachineInput(rive, "bumpy", "bump");

  return (
    <div className="glass-card w-full max-w-sm p-6 rounded-3xl flex flex-col items-center gap-6 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 blur-3xl -z-10" />
      <div className="w-full flex items-center justify-between">
        <h3 className="text-white font-semibold">Canlı Demo</h3>
        <span className="text-xs px-2 py-1 bg-white/10 rounded-md text-zinc-300 font-mono">.riv yüklendi</span>
      </div>
      
      <div 
        className="w-full h-48 bg-white/5 rounded-2xl border border-white/10 relative overflow-hidden group cursor-pointer"
        onClick={() => bumpInput && bumpInput.fire()}
      >
        <RiveComponent className="w-full h-full" />
        <div className="absolute bottom-2 right-2 px-3 py-1 bg-black/50 backdrop-blur-md rounded-full text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
          Tıkla ve zıplat!
        </div>
      </div>
      
      <div className="w-full">
        <h4 className="text-sm text-zinc-400 mb-2">React Entegrasyonu:</h4>
        <div className="bg-black/50 p-4 rounded-xl border border-white/10 font-mono text-xs text-zinc-300 overflow-x-auto">
          <code>{`const { RiveComponent } = useRive({
  src: "animasyon.riv",
  stateMachines: "bumpy"
});

return <RiveComponent />;`}</code>
        </div>
      </div>

      <div className="w-full pt-4 border-t border-white/10">
        <a 
          href="https://cdn.rive.app/animations/vehicles.riv" 
          download
          className="flex items-center justify-center w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 transition-colors text-white text-sm font-medium border border-white/20"
        >
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Ücretsiz Demo .riv İndir
        </a>
      </div>
    </div>
  );
}
