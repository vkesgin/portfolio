export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Basit ve Şeffaf Fiyatlandırma
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Bir kez öde, hayat boyu kullan. Tüm Rive animasyonlarına, kaynak kodlarına ve gelecekteki güncellemelere sınırsız erişim sağla.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Free Tier */}
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 flex flex-col relative overflow-hidden">
            <h3 className="text-2xl font-bold mb-2">Başlangıç</h3>
            <div className="text-white/50 mb-6">Temel bileşenler ile tanışın.</div>
            <div className="text-5xl font-bold mb-8">Ücretsiz</div>
            
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3">
                <span className="text-green-500">✓</span> Ücretsiz bileşenlere erişim
              </li>
              <li className="flex items-center gap-3">
                <span className="text-green-500">✓</span> React kaynak kodları
              </li>
              <li className="flex items-center gap-3 text-white/30">
                <span className="text-white/20">×</span> PRO bileşenlere erişim
              </li>
              <li className="flex items-center gap-3 text-white/30">
                <span className="text-white/20">×</span> Orijinal .riv dosyaları
              </li>
            </ul>

            <button className="w-full py-4 rounded-full bg-white/10 hover:bg-white/20 font-semibold transition-colors">
              Hemen Başla
            </button>
          </div>

          {/* Pro Tier */}
          <div className="rounded-3xl border border-[#ff2b73]/30 bg-gradient-to-b from-[#ff2b73]/10 to-transparent p-8 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-[#ff2b73] text-white text-xs font-bold px-4 py-1 rounded-bl-xl uppercase tracking-wide">
              En Popüler
            </div>
            <h3 className="text-2xl font-bold mb-2">PRO Paket</h3>
            <div className="text-white/50 mb-6">Profesyoneller ve takımlar için.</div>
            <div className="text-5xl font-bold mb-2">$49<span className="text-lg text-white/50 font-normal"> / ömür boyu</span></div>
            <div className="text-sm text-white/40 mb-8">Tek seferlik ödeme</div>
            
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> <strong>Tüm</strong> UI bileşenlerine erişim
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> Orijinal <strong>.riv dosyalarını</strong> indirme
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> Ticari kullanım lisansı
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> Hazır web şablonlarına erişim
              </li>
            </ul>

            <button className="w-full py-4 rounded-full bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-semibold transition-colors shadow-[0_0_20px_rgba(255,43,115,0.4)]">
              PRO'ya Geç
            </button>
          </div>
        </div>
        
        {/* SSS (FAQ) */}
        <div className="mt-32 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Sıkça Sorulan Sorular</h2>
          <div className="space-y-8">
            <div>
              <h4 className="text-lg font-bold mb-2">Tek seferlik ödeme ne anlama geliyor?</h4>
              <p className="text-white/60">Abonelik modeli kullanmıyoruz. Bir kez ödeme yaptığınızda kütüphanedeki tüm mevcut ve gelecekte eklenecek bileşenlere ömür boyu sahip olursunuz.</p>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-2">İndirdiğim bileşenleri müşteri projelerinde kullanabilir miyim?</h4>
              <p className="text-white/60">Evet, PRO lisansı ticari kullanım hakkı sunar. İndirdiğiniz Rive dosyalarını ve React kodlarını hem kendi projelerinizde hem de müşteri projelerinde sınırsızca kullanabilirsiniz.</p>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-2">Rive (.riv) dosyalarını düzenleyebilir miyim?</h4>
              <p className="text-white/60">Kesinlikle! PRO paketi ile animasyonların orijinal .riv dosyalarını indirip kendi Rive hesabınıza aktarabilir, renklerini ve tasarımlarını dilediğiniz gibi değiştirebilirsiniz.</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
