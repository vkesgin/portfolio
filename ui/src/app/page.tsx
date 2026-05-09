import RiveDemo from '@/components/RiveDemo';
import Link from 'next/link';

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {components.map((comp) => (
              <div key={comp.id} className="group flex flex-col bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden hover:border-white/10 transition-colors">
                
                {/* PREVIEW KISMI */}
                <div className="relative aspect-[4/3] w-full bg-black/40 flex items-center justify-center p-8 overflow-hidden">
                  <div className="absolute top-4 right-4 z-10 flex gap-2">
                    {comp.is_featured && (
                      <span className="px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white">PRO</span>
                    )}
                    {!comp.is_featured && (
                      <span className="px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-white/10 text-white">FREE</span>
                    )}
                  </div>
                  
                  {comp.image_url ? (
                    <div className="w-full h-full relative group-hover:scale-105 transition-transform duration-500">
                      <RiveDemo 
                        src={`https://vk-portfolio-api.vkesgin38.workers.dev${comp.image_url}`} 
                      />
                    </div>
                  ) : (
                    <div className="text-white/20 text-sm">Görsel Yok</div>
                  )}
                </div>

                {/* INFO KISMI */}
                <div className="p-6 border-t border-white/5 flex-1 flex flex-col">
                  <h3 className="text-lg font-semibold mb-2 group-hover:text-[#ff2b73] transition-colors">{comp.title}</h3>
                  
                  {/* React Kaynak Kodu (Sadece görsel, gerçekte detay sayfasına gider) */}
                  <div className="mt-auto pt-6 flex gap-2">
                    <button className="flex-1 py-3 text-sm font-medium rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                      Kodu Kopyala
                    </button>
                    <button className="w-12 h-12 flex items-center justify-center rounded-xl bg-white/5 hover:bg-[#ff2b73] hover:text-white transition-colors">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </button>
                  </div>
                </div>

              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
