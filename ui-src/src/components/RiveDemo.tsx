"use client";

import { useRive, StateMachineInputType } from "@rive-app/react-canvas";
import { useEffect, useRef } from "react";

interface RiveDemoProps {
  src: string;
  artboard?: string;
  stateMachine?: string;
}

export default function RiveDemo({ src, artboard, stateMachine }: RiveDemoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clickTriggers = useRef<any[]>([]);
  const hoverInputs = useRef<any[]>([]);
  const xInputs = useRef<any[]>([]);
  const yInputs = useRef<any[]>([]);

  const config: any = {
    src: src,
    autoplay: true,
  };
  
  if (artboard) config.artboard = artboard;
  if (stateMachine) config.stateMachines = stateMachine;

  const { rive, RiveComponent } = useRive({
    ...config,
    onLoad: () => {
      if (rive) {
        // Tüm State Machine'leri başlat ve Inputlarını (Girdileri) topla
        const stateMachines = rive.stateMachineNames;
        
        if (stateMachines && stateMachines.length > 0) {
          stateMachines.forEach(sm => {
            rive.play(sm);
            
            // Bu State Machine'in içindeki interaktif değişkenleri (Inputs) al
            const inputs = rive.stateMachineInputs(sm);
            if (inputs) {
              inputs.forEach(input => {
                const name = input.name.toLowerCase();
                
                // 1. Tıklama / Tetikleyici (Trigger) kontrolü
                if (input.type === StateMachineInputType.Trigger) { 
                  clickTriggers.current.push(input);
                } 
                // Eğer boolean ise ve ismi click/press içeriyorsa
                else if (input.type === StateMachineInputType.Boolean && (name.includes('click') || name.includes('press'))) {
                  clickTriggers.current.push(input);
                }
                // 2. Hover (Üzerine gelme) kontrolü
                else if (input.type === StateMachineInputType.Boolean && name.includes('hover')) {
                  hoverInputs.current.push(input);
                }
                // 3. Mouse Takibi (Fare X ve Y koordinatları) kontrolü
                else if (input.type === StateMachineInputType.Number) { 
                  if (name.includes('x')) xInputs.current.push(input);
                  if (name.includes('y')) yInputs.current.push(input);
                }
              });
            }
          });
        } else {
          rive.play();
        }
      }
    }
  });

  // Olay Dinleyicileri (Event Listeners)
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
    
    // Mouse çıkınca X ve Y koordinatlarını merkeze (50) çek
    xInputs.current.forEach(input => { input.value = 50; });
    yInputs.current.forEach(input => { input.value = 50; });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 0-100 arasına oranla (Rive genellikle 0-100 veya 0-1 arası bekler, çoğunlukla 0-100)
    const xPercent = (x / rect.width) * 100;
    const yPercent = (y / rect.height) * 100;
    
    xInputs.current.forEach(input => { input.value = xPercent; });
    yInputs.current.forEach(input => { input.value = yPercent; });
  };

  return (
    <div 
      ref={containerRef}
      className="w-full h-full flex items-center justify-center cursor-pointer"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      <RiveComponent className="w-full h-full pointer-events-none" />
    </div>
  );
}
