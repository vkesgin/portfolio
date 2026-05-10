"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#050505]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl tracking-tighter">
          VK<span className="text-[#ff2b73]">UI</span>
        </Link>
        <nav className="flex gap-6 text-sm font-medium text-white/60">
          <Link
            href="/"
            className={`transition-colors ${
              pathname === "/" ? "text-white" : "hover:text-white"
            }`}
          >
            Bileşenler
          </Link>
          <Link
            href="/templates"
            className={`transition-colors ${
              pathname === "/templates" ? "text-white" : "hover:text-white"
            }`}
          >
            Şablonlar
          </Link>
          <Link
            href="/pricing"
            className={`transition-colors ${
              pathname === "/pricing" ? "text-white" : "hover:text-white"
            }`}
          >
            Fiyatlandırma
          </Link>
        </nav>
        <div className="flex gap-4 items-center">
          <Link
            href="/docs"
            className="text-sm font-medium text-white/60 hover:text-white transition-colors"
          >
            Dokümantasyon
          </Link>
          <a
            href="https://velikesgin.com"
            className="text-xs font-medium px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
          >
            Portfolyoya Dön ↗
          </a>
        </div>
      </div>
    </header>
  );
}
