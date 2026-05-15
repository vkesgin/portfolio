import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Özel Animasyon Yapımı & Lottie Tasarımı | V.Kesgin",
  description: "Markanızın ruhunu yansıtan, piksel mükemmelliğinde özel web ve mobil uygulama animasyonları tasarlıyoruz. Hemen ücretsiz teklif alın.",
  alternates: {
    canonical: "https://velikesgin.com/ui/ozel-uretim",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Service",
  "serviceType": "Custom Animation Design",
  "provider": {
    "@type": "Person",
    "name": "Veli Kesgin"
  },
  "areaServed": "Global",
  "description": "Web ve mobil uygulamalar için Rive, Lottie ve JSON tabanlı özel interaktif animasyon tasarımı."
};

export default function OzelUretimPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f]">
            Özel Animasyon Tasarımı
          </h1>
          <p className="text-xl text-white/50 max-w-2xl mx-auto">
            Sıradan şablonlarla yetinmeyin. Markanızın ruhunu yansıtan, piksel mükemmelliğinde ve 60 FPS akıcılığında size özel etkileşimli animasyonlar tasarlayalım.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-16">
          <div className="bg-white/5 border border-white/10 p-8 rounded-3xl">
            <h3 className="text-2xl font-bold mb-4">Neden Özel Üretim?</h3>
            <ul className="space-y-4 text-white/70">
              <li className="flex gap-3">
                <span className="text-[#ff2b73]">✦</span>
                Marka kimliğinize (renk, font, his) %100 uyum.
              </li>
              <li className="flex gap-3">
                <span className="text-[#ff2b73]">✦</span>
                Kullanıcı senaryolarınıza özel State Machine (Durum Makinesi) etkileşimleri.
              </li>
              <li className="flex gap-3">
                <span className="text-[#ff2b73]">✦</span>
                Lottie/JSON veya Rive formatında platform bağımsız optimize teslimat.
              </li>
            </ul>
          </div>

          <div className="bg-[#ff2b73]/10 border border-[#ff2b73]/30 p-8 rounded-3xl flex flex-col justify-center items-center text-center">
            <h3 className="text-2xl font-bold mb-4">Projeyi Konuşalım</h3>
            <p className="text-white/70 mb-8">İhtiyacınız olan mikro etkileşimi, onboarding animasyonunu veya UI bileşenini hayata geçirelim.</p>
            <a href="mailto:iletisim@velikesgin.com" className="px-8 py-4 bg-[#ff2b73] text-white font-bold rounded-xl hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,43,115,0.4)]">
              Hemen İletişime Geçin
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
