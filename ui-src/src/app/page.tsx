import Link from 'next/link';
import ComponentGrid from '@/components/ComponentGrid';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-[#ff2b73] selection:text-white pb-20">

      {/* HERO SECTION */}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff2b73]/10 text-[#ff2b73] text-xs font-semibold tracking-wide uppercase mb-6 border border-[#ff2b73]/20">
            <span className="w-2 h-2 rounded-full bg-[#ff2b73] animate-pulse"></span>
            Erken Erişim
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8">
            <span className="sr-only">Rive UI Component Library - React & Next.js Animasyonları. </span>
            Etkileşimli. Canlı. <br className="hidden md:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f]">
              Kusursuz.
            </span>
          </h1>
          <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto leading-relaxed mb-10">
            Modern web için tasarlanmış, <strong>Rive animasyonlarıyla</strong> güçlendirilmiş, anında kopyala-yapıştır yapabileceğin premium <strong>React ve Flutter UI bileşen kütüphanesi</strong>. Hazır etkileşimli state machine dosyalarıyla projelerinizi canlandırın.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="#components" className="px-8 py-4 rounded-full bg-white text-black font-semibold hover:scale-105 transition-transform">
              Bileşenleri Keşfet
            </Link>
            <Link href="/docs" className="px-8 py-4 rounded-full bg-white/5 font-semibold hover:bg-white/10 transition-colors">
              Nasıl Kullanılır?
            </Link>
          </div>
        </div>
      </section>

      {/* BİLEŞENLER LİSTESİ */}
      <section id="components" className="px-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold">En Yeni Bileşenler</h2>
        </div>

        <ComponentGrid />
      </section>

    </div>
  );
}
