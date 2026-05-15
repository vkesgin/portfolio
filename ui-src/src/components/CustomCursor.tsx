"use client";

import { useEffect, useRef } from "react";

export default function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only run on desktop
    if (window.matchMedia('(max-width: 768px)').matches) return;

    const cursorDot = cursorRef.current;
    const cursorRing = ringRef.current;
    if (!cursorDot || !cursorRing) return;

    let mouseX = -9999;
    let mouseY = -9999;
    let cx = 0, cy = 0, rx = 0, ry = 0;
    let animationFrameId: number;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    function loopCursor() {
      cx += (mouseX - cx) * 0.15;
      cy += (mouseY - cy) * 0.15;
      rx += (cx - rx) * 0.11;
      ry += (cy - ry) * 0.11;
      
      if (cursorDot && cursorRing) {
        cursorDot.style.left = `${cx}px`;
        cursorDot.style.top = `${cy}px`;
        cursorRing.style.left = `${rx}px`;
        cursorRing.style.top = `${ry}px`;
      }
      animationFrameId = requestAnimationFrame(loopCursor);
    }

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isHoverable = target.closest('a, button, input, [role="button"], .interactive-element');
      if (isHoverable) {
        cursorDot.classList.add('hover');
        cursorRing.classList.add('hover');
      } else {
        cursorDot.classList.remove('hover');
        cursorRing.classList.remove('hover');
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseover', handleMouseOver);
    loopCursor();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseover', handleMouseOver);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <>
      <div 
        ref={cursorRef} 
        id="cursor"
      ></div>
      <div 
        ref={ringRef} 
        id="cursor-ring"
      ></div>
    </>
  );
}
