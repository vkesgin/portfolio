import Link from 'next/link';
import ComponentGrid from '@/components/ComponentGrid';

// Component tipleri
interface UIComponent {
  id: string;
  title: string;
  category: string;
  description: string; // React Kodu burada tutuluyor
  image_url: string; // .riv animasyon url'si burada tutuluyor
  is_featured: boolean; // PRO durumu
}

// Sunucudan (Cloudflare Worker'dan) bileşenleri çeken fonksiyon
async function getComponents() {
  try {
    const res = await fetch('https://vk-portfolio-api.vkesgin38.workers.dev/api/projects?category=uilib', {
      next: { revalidate: 60 } // Her 60 saniyede bir önbelleği yenile
    });
    
    if (!res.ok) {
      throw new Error('Veri çekilemedi');
    }
    
    return await res.json() as UIComponent[];
  } catch (error) {
    console.error("Bileşenler çekilirken hata:", error);
    return [];
  }
}

export default async function Home() {
  const components = await getComponents();

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-[#ff2b73] selection:text-white pb-20">
      
      {/* HEADER */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#050505]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="font-bold text-xl tracking-tighter">
            VK<span className="text-[#ff2b73]">UI</span>
          </Link>
          <nav className="flex gap-6 text-sm font-medium text-white/60">
            <Link href="#" className="hover:text-white transition-colors">Bileşenler</Link>
            <Link href="#" className="hover:text-white transition-colors">Şablonlar</Link>
            <Link href="#" className="hover:text-white transition-colors">Fiyatlandırma</Link>
          </nav>
          <a href="https://velikesgin.com" className="text-xs font-medium px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors">
            Portfolyoya Dön ↗
          </a>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#ff2b73]/10 text-[#ff2b73] text-xs font-semibold tracking-wide uppercase mb-6 border border-[#ff2b73]/20">
            <span className="w-2 h-2 rounded-full bg-[#ff2b73] animate-pulse"></span>
            Erken Erişim
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8">
            Etkileşimli. Canlı. <br className="hidden md:block"/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f]">
              Kusursuz.
            </span>
          </h1>
          <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto leading-relaxed mb-10">
            Modern web için tasarlanmış, Rive animasyonlarıyla güçlendirilmiş, anında kopyala-yapıştır yapabileceğin React bileşen kütüphanesi.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button className="px-8 py-4 rounded-full bg-white text-black font-semibold hover:scale-105 transition-transform">
              Bileşenleri Keşfet
            </button>
            <button className="px-8 py-4 rounded-full bg-white/5 font-semibold hover:bg-white/10 transition-colors">
              Nasıl Kullanılır?
            </button>
          </div>
        </div>
      </section>

      {/* BİLEŞENLER LİSTESİ */}
      <section className="px-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-12">
          <h2 className="text-2xl font-bold">En Yeni Bileşenler</h2>
          <div className="text-sm text-white/40">{components.length} bileşen</div>
        </div>

        {components.length === 0 ? (
          <div className="py-20 text-center border border-white/5 rounded-3xl bg-white/[0.02]">
            <div className="w-16 h-16 mx-auto mb-4 opacity-20">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            <p className="text-white/40">Henüz bileşen eklenmedi.</p>
            <p className="text-white/20 text-sm mt-2">Admin panelinden ilk bileşenini ekleyebilirsin.</p>
          </div>
        ) : (
          <ComponentGrid components={components} />
        )}
      </section>

    </div>
  );
}
