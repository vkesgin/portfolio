import Link from "next/link";

export default function TemplatesPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Rive ile Güçlendirilmiş Şablonlar
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Gelişmiş animasyonları ve kusursuz tasarımı tek bir pakette sunan, hemen kullanıma hazır tam sayfa Next.js şablonları.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Template 1 */}
          <div className="group rounded-3xl border border-white/10 bg-white/5 overflow-hidden flex flex-col">
            <div className="aspect-video bg-[#111] relative overflow-hidden flex items-center justify-center border-b border-white/5">
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10"></div>
              <div className="text-white/20 font-bold text-2xl group-hover:scale-105 transition-transform duration-500">Önizleme Yakında</div>
              <div className="absolute top-4 right-4 z-20 px-3 py-1 rounded-full bg-[#ff2b73] text-xs font-bold uppercase">PRO</div>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <h3 className="text-xl font-bold mb-2">Modern SaaS Landing Page</h3>
              <p className="text-white/50 text-sm mb-6 flex-1">
                İnteraktif ürün vitrinleri, animasyonlu özellik kartları ve Rive ile güçlendirilmiş çağrı-toplama (CTA) bölümleri içeren tam sayfa SaaS şablonu.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono text-white/40">Next.js + Tailwind</span>
                <Link href="/pricing" className="text-sm font-semibold text-[#ff2b73] hover:text-[#ff2b73]/80 transition-colors">
                  PRO'ya Geç →
                </Link>
              </div>
            </div>
          </div>

          {/* Template 2 */}
          <div className="group rounded-3xl border border-white/10 bg-white/5 overflow-hidden flex flex-col">
            <div className="aspect-video bg-[#111] relative overflow-hidden flex items-center justify-center border-b border-white/5">
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10"></div>
              <div className="text-white/20 font-bold text-2xl group-hover:scale-105 transition-transform duration-500">Önizleme Yakında</div>
              <div className="absolute top-4 right-4 z-20 px-3 py-1 rounded-full bg-white/10 text-white/80 text-xs font-bold uppercase">ÜCRETSİZ</div>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <h3 className="text-xl font-bold mb-2">Minimalist Login & Auth</h3>
              <p className="text-white/50 text-sm mb-6 flex-1">
                Kullanıcı adı ve şifre girerken tepki veren Rive karakterleri barındıran (örneğin ayıcık veya kedi) akıllı ve eğlenceli giriş sayfası tasarımı.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono text-white/40">Next.js + Tailwind</span>
                <button className="text-sm font-semibold text-white hover:text-white/80 transition-colors">
                  Kodu Gör
                </button>
              </div>
            </div>
          </div>

          {/* Template 3 */}
          <div className="group rounded-3xl border border-[#ff2b73]/30 bg-gradient-to-b from-[#ff2b73]/5 to-transparent overflow-hidden flex flex-col">
            <div className="aspect-video bg-[#111] relative overflow-hidden flex items-center justify-center border-b border-[#ff2b73]/20">
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10"></div>
              <div className="text-white/20 font-bold text-2xl group-hover:scale-105 transition-transform duration-500">Önizleme Yakında</div>
              <div className="absolute top-4 right-4 z-20 px-3 py-1 rounded-full bg-[#ff2b73] text-xs font-bold uppercase">PRO</div>
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <h3 className="text-xl font-bold mb-2">Kişisel Portfolyo 3D/Rive</h3>
              <p className="text-white/50 text-sm mb-6 flex-1">
                İnteraktif yetenek barları, dinamik butonlar ve akıcı geçişlerle dolu, yazılımcılar ve tasarımcılar için üst düzey portfolyo şablonu.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono text-white/40">Next.js + Tailwind</span>
                <Link href="/pricing" className="text-sm font-semibold text-[#ff2b73] hover:text-[#ff2b73]/80 transition-colors">
                  PRO'ya Geç →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
