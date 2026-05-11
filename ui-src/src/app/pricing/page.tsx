"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function PricingPage() {
  const [user, setUser] = useState<any>(null);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");

  useEffect(() => {
    async function fetchUser() {
      const token = localStorage.getItem("ui_token");
      if (token) {
        try {
          const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/me", {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            setUser(data.user);
          }
        } catch (err) {}
      }
    }
    fetchUser();
  }, []);

  const isPro = user?.plan === "PRO";
  
  // BURAYA AYLIK VE YILLIK LEMON SQUEEZY LİNKLERİNİ GİRECEKSİN (Sondaki parametreyi silmeden)
  const monthlyLink = "https://velikesgin.lemonsqueezy.com/checkout/buy/4862289b-3640-4a46-aaee-151a0c52caad";
  const yearlyLink = "https://velikesgin.lemonsqueezy.com/checkout/buy/4178f6ee-876c-41ca-8537-bc51e38a4e2f";
  
  const currentBaseUrl = billingCycle === "monthly" ? monthlyLink : yearlyLink;
  const redirectUrl = encodeURIComponent("https://velikesgin.com/ui/dashboard");
  const lsCheckoutUrl = user
    ? `${currentBaseUrl}?checkout[custom][user_id]=${user.id}&checkout[redirect_url]=${redirectUrl}`
    : "/ui/login";

  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Basit ve Şeffaf Fiyatlandırma
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto mb-10">
            Abonelik tabanlı modelimizle tüm Rive animasyonlarına, kaynak kodlarına ve sürekli güncellenen kütüphanemize erişim sağlayın. Tek seferlik ömür boyu paketimiz bulunmamaktadır.
          </p>

          <div className="p-4 mb-10 max-w-2xl mx-auto rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-sm text-white/80">
            <strong className="text-yellow-400">Önemli Not:</strong> Giriş yapmayan ziyaretçiler, bileşenlerin yalnızca önizlemelerini görebilirler. Kaynak kodlarına ve orijinal .riv dosyalarına erişebilmek için <strong>ücretsiz üye olmanız</strong> veya <strong>giriş yapmanız</strong> gerekmektedir.
          </div>

          {/* Billing Toggle */}
          <div className="inline-flex items-center p-1 bg-white/5 border border-white/10 rounded-full mx-auto">
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all ${
                billingCycle === "monthly" ? "bg-[#ff2b73] text-white shadow-lg shadow-[#ff2b73]/20" : "text-white/50 hover:text-white"
              }`}
            >
              Aylık Ödeme
            </button>
            <button
              onClick={() => setBillingCycle("yearly")}
              className={`px-6 py-2.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
                billingCycle === "yearly" ? "bg-[#ff2b73] text-white shadow-lg shadow-[#ff2b73]/20" : "text-white/50 hover:text-white"
              }`}
            >
              Yıllık Ödeme
              <span className={`px-2 py-0.5 text-[10px] rounded-full uppercase font-bold ${
                billingCycle === "yearly" ? "bg-white/20 text-white" : "bg-[#ff2b73]/20 text-[#ff2b73]"
              }`}>
                %35 Kar
              </span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Free Tier */}
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 flex flex-col relative overflow-hidden">
            <h3 className="text-2xl font-bold mb-2">Ücretsiz Üyelik</h3>
            <div className="text-white/50 mb-6">Temel bileşenler ile tanışın. Sadece giriş yapan kullanıcılar erişebilir.</div>
            <div className="text-5xl font-bold mb-8">$0<span className="text-lg text-white/50 font-normal"> / ay</span></div>
            
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3">
                <span className="text-green-500">✓</span> Ücretsiz bileşenlerin kodlarına erişim
              </li>
              <li className="flex items-center gap-3">
                <span className="text-green-500">✓</span> Ücretsiz bileşenlerin orijinal <strong>.riv dosyalarını</strong> indirme
              </li>
              <li className="flex items-center gap-3">
                <span className="text-green-500">✓</span> <strong>Aylık 5 indirme hakkı</strong> (Her ay yenilenir)
              </li>
              <li className="flex items-center gap-3 text-white/30">
                <span className="text-white/20">×</span> PRO bileşenlere erişim
              </li>
              <li className="flex items-center gap-3 text-white/30">
                <span className="text-white/20">×</span> Hazır web şablonlarına erişim
              </li>
            </ul>

            {!user ? (
              <Link href="/login" className="block text-center w-full py-4 rounded-full bg-white/10 hover:bg-white/20 font-semibold transition-colors">
                Hemen Üye Ol
              </Link>
            ) : isPro ? (
              <Link href="/dashboard" className="block text-center w-full py-4 rounded-full bg-white/10 hover:bg-white/20 font-semibold transition-colors">
                Kütüphaneye Git
              </Link>
            ) : (
              <button disabled className="w-full py-4 rounded-full bg-white/10 text-white/50 font-semibold cursor-not-allowed">
                Mevcut Paketiniz
              </button>
            )}
          </div>

          {/* Pro Tier */}
          <div className="rounded-3xl border border-[#ff2b73]/30 bg-gradient-to-b from-[#ff2b73]/10 to-transparent p-8 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-[#ff2b73] text-white text-xs font-bold px-4 py-1 rounded-bl-xl uppercase tracking-wide">
              En Popüler
            </div>
            <h3 className="text-2xl font-bold mb-2">PRO Paket</h3>
            <div className="text-white/50 mb-6">Sınırsız erişim isteyen profesyoneller için.</div>
            
            {billingCycle === "monthly" ? (
              <>
                <div className="text-5xl font-bold mb-2">$12<span className="text-lg text-white/50 font-normal"> / ay</span></div>
                <div className="text-sm text-white/40 mb-8">Her ay faturalandırılır</div>
              </>
            ) : (
              <>
                <div className="text-5xl font-bold mb-2">$7.49<span className="text-lg text-white/50 font-normal"> / ay</span></div>
                <div className="text-sm text-white/40 mb-8">Yılda bir kez $89.99 olarak faturalandırılır</div>
              </>
            )}
            
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> <strong>Tüm</strong> (Free + PRO) UI bileşenlerine erişim
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> Tüm bileşenlerin orijinal <strong>.riv dosyalarını</strong> indirme
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> <strong>Sınırsız</strong> indirme hakkı
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> <strong>Hazır web şablonlarına</strong> erişim
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#ff2b73]">✓</span> Ticari kullanım lisansı
              </li>
            </ul>

            {isPro ? (
              <button disabled className="w-full py-4 rounded-full bg-[#ff2b73]/50 text-white font-semibold cursor-not-allowed">
                Şu Anda PRO Üyesiniz
              </button>
            ) : (
              <a href={lsCheckoutUrl} className="block text-center w-full py-4 rounded-full bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-semibold transition-colors shadow-[0_0_20px_rgba(255,43,115,0.4)]">
                PRO'ya Geç
              </a>
            )}
          </div>
        </div>
        
        {/* SSS (FAQ) */}
        <div className="mt-32 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Sıkça Sorulan Sorular</h2>
          <div className="space-y-8">
            <div>
              <h4 className="text-lg font-bold mb-2">Giriş yapmadan kodlara veya animasyonlara erişebilir miyim?</h4>
              <p className="text-white/60">Hayır, giriş yapmayan ziyaretçilerimiz sadece kütüphanedeki bileşenlerin önizlemelerini görebilirler. Kaynak kodlarına ve animasyon dosyalarına erişmek için ücretsiz olarak üye olmanız gerekmektedir.</p>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-2">Ücretsiz üyelikte indirme sınırı var mı?</h4>
              <p className="text-white/60">Evet, ücretsiz üyelikte her ay 5 indirme (kod görüntüleme veya .riv indirme) hakkınız bulunmaktadır. Bu haklarınız her ay yenilenir. Sınırsız erişim için PRO pakete geçebilirsiniz.</p>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-2">İndirdiğim bileşenleri müşteri projelerinde kullanabilir miyim?</h4>
              <p className="text-white/60">Evet, PRO lisansı ticari kullanım hakkı sunar. İndirdiğiniz Rive dosyalarını ve React kodlarını hem kendi projelerinizde hem de müşteri projelerinde sınırsızca kullanabilirsiniz.</p>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-2">Hazır web şablonları nedir?</h4>
              <p className="text-white/60">PRO paketi, animasyonların sadece tek tek bileşenlerini değil, bir bütün olarak kullanıldığı kullanıma hazır Next.js / React web şablonlarına erişim imkanı sunar.</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
