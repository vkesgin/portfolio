import { Metadata } from "next";
import ComponentGrid from "@/components/ComponentGrid";

export const metadata: Metadata = {
  title: "Ücretsiz JSON Animasyonları İndir | Web & Mobil Uyumlu",
  description: "Geliştiriciler ve tasarımcılar için 60FPS hızında, ücretsiz JSON ve Lottie uyumlu Rive animasyonları. Projenize tek tıkla kopyalayın veya indirin.",
  alternates: {
    canonical: "https://velikesgin.com/ui/animasyonlar/ucretsiz-json",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Ücretsiz JSON ve Rive Animasyonları Arşivi",
  "operatingSystem": "Web, iOS, Android",
  "applicationCategory": "DeveloperApplication",
  "offers": {
    "@type": "Offer",
    "price": "0.00",
    "priceCurrency": "USD"
  },
  "description": "Web ve mobil projeleriniz için yüksek performanslı, ücretsiz animasyon dosyaları. Tek tıkla indir ve kullan."
};

export default function UcretsizJsonPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Modern ve Ücretsiz JSON Animasyonları Arşivi
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Projelerinizi canlandırmak için Lottie/JSON uyumlu ve Rive tabanlı ücretsiz animasyonlar. 
            Aşağıdaki kütüphaneden beğendiğiniz animasyonu projenize saniyeler içinde dahil edin.
          </p>
        </div>

        {/* İçerik SEO & Tanımsal Kurgu */}
        <div className="max-w-4xl mx-auto mb-16 p-6 rounded-2xl bg-white/5 border border-white/10">
          <h2 className="text-2xl font-bold mb-4">JSON (Lottie/Rive) Animasyon Nedir?</h2>
          <p className="text-white/70 mb-4">
            <strong>Özet:</strong> JSON animasyon, vektörel çizimlerin ve hareket verilerinin metin tabanlı olarak kodlandığı, çok düşük dosya boyutuna sahip yüksek performanslı animasyon formatıdır. Geleneksel GIF veya MP4 dosyalarının aksine, web ve mobil uygulamalarda cihazı yormadan 60 FPS akıcılığında çalışır.
          </p>
          <ul className="list-disc pl-5 text-white/60 space-y-2">
            <li><strong>Yüksek Performans:</strong> Sayfa hızınızı yavaşlatmaz, SEO ve Core Web Vitals dostudur.</li>
            <li><strong>Ölçeklenebilirlik:</strong> Çözünürlük bağımsız olduğu için retina ekranlarda dahil pikselleşmez.</li>
            <li><strong>Etkileşim:</strong> Kullanıcı fareyle üzerine geldiğinde (hover) veya tıkladığında tepki verebilir.</li>
          </ul>
        </div>

        <ComponentGrid />
      </div>
    </main>
  );
}
