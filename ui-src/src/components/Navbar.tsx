"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Sadece token kontrolü yapıyoruz, geçerlilik kontrolünü sayfalara bırakıyoruz
    const token = localStorage.getItem("ui_token");
    if (token) setIsLoggedIn(true);
  }, []);

  // Sayfa değiştiğinde mobil menüyü kapat
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#050505]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Sol Kısım: Logo ve Masaüstü Linkleri */}
        <div className="flex items-center gap-8">
          <Link href="/" className="font-bold text-xl tracking-tighter shrink-0">
            VK<span className="text-[#ff2b73]">UI</span>
          </Link>
          <nav className="hidden md:flex gap-6 text-sm font-medium text-white/60">
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
        </div>
        
        {/* Sağ Kısım: Aksiyon Butonları (Masaüstü) */}
        <div className="hidden md:flex gap-4 items-center shrink-0">
          <Link
            href="/docs"
            className={`text-sm font-medium transition-colors ${
              pathname === "/docs" ? "text-white" : "text-white/60 hover:text-white"
            }`}
          >
            Dokümantasyon
          </Link>
          <div className="w-px h-4 bg-white/10 mx-2"></div>
          <a
            href="https://velikesgin.com"
            className="text-xs font-medium px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
          >
            Portfolyoya Dön ↗
          </a>
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="text-xs font-medium px-4 py-2 rounded-full bg-[#ff2b73]/20 text-[#ff2b73] hover:bg-[#ff2b73]/30 transition-colors border border-[#ff2b73]/30"
            >
              Panelim
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-xs font-medium px-4 py-2 rounded-full bg-white text-black hover:bg-white/90 transition-colors"
            >
              Giriş Yap
            </Link>
          )}
        </div>

        {/* Mobil Hamburger Menü Butonu */}
        <button
          className="md:hidden p-2 -mr-2 text-white/80 hover:text-white shrink-0"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Menüyü aç/kapat"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {isMobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobil Menü Açılır Alanı */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-white/5 bg-[#050505] p-4 flex flex-col gap-4 max-h-[calc(100vh-4rem)] overflow-y-auto">
          <nav className="flex flex-col gap-4 text-sm font-medium text-white/60">
            <Link
              href="/"
              className={`transition-colors px-2 py-1 ${
                pathname === "/" ? "text-white" : "hover:text-white"
              }`}
            >
              Bileşenler
            </Link>
            <Link
              href="/templates"
              className={`transition-colors px-2 py-1 ${
                pathname === "/templates" ? "text-white" : "hover:text-white"
              }`}
            >
              Şablonlar
            </Link>
            <Link
              href="/pricing"
              className={`transition-colors px-2 py-1 ${
                pathname === "/pricing" ? "text-white" : "hover:text-white"
              }`}
            >
              Fiyatlandırma
            </Link>
            <Link
              href="/docs"
              className={`transition-colors px-2 py-1 ${
                pathname === "/docs" ? "text-white" : "hover:text-white"
              }`}
            >
              Dokümantasyon
            </Link>
          </nav>
          
          <div className="h-px bg-white/10 my-2"></div>
          
          <div className="flex flex-col gap-3 pb-4">
            {isLoggedIn ? (
              <Link
                href="/dashboard"
                className="text-sm font-medium px-4 py-2.5 rounded-lg bg-[#ff2b73]/20 text-[#ff2b73] hover:bg-[#ff2b73]/30 transition-colors border border-[#ff2b73]/30 text-center"
              >
                Panelim
              </Link>
            ) : (
              <Link
                href="/login"
                className="text-sm font-medium px-4 py-2.5 rounded-lg bg-white text-black hover:bg-white/90 transition-colors text-center"
              >
                Giriş Yap
              </Link>
            )}
            <a
              href="https://velikesgin.com"
              className="text-sm font-medium px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-center"
            >
              Portfolyoya Dön ↗
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
