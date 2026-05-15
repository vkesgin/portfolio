import { Metadata } from "next";
import ComponentGrid from "@/components/ComponentGrid";

export const metadata: Metadata = {
  title: "Modern Loading Animasyonları (JSON & Rive)",
  description: "Uygulamanızı hızlandıracak hafif, şık ve ücretsiz loading (yükleme) animasyonları. React, Vue ve mobil uyumlu dosyalar.",
  alternates: {
    canonical: "https://velikesgin.com/ui/animasyonlar/loading",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Modern Loading Animasyonları",
  "operatingSystem": "Web, iOS, Android",
  "applicationCategory": "DeveloperApplication",
  "offers": {
    "@type": "Offer",
    "price": "0.00",
    "priceCurrency": "USD"
  },
  "description": "Performansı etkilemeyen hafif ve akıcı yükleme (loading) animasyonları paketi."
};

export default function LoadingAnimasyonPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 text-[#ff2b73]">
            Loading Animasyonları
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Web sitenizin veya mobil uygulamanızın bekleme sürelerini sıkıcı olmaktan çıkarın. 
            Yüksek performanslı, CSS ve JSON (Lottie/Rive) tabanlı yükleme animasyonları.
          </p>
        </div>

        <div className="max-w-4xl mx-auto mb-16 p-6 rounded-2xl bg-white/5 border border-white/10">
          <h2 className="text-2xl font-bold mb-4">Neden Hafif Yükleme (Loading) Animasyonları Kullanmalısınız?</h2>
          <p className="text-white/70 mb-4">
            Ağır bir GIF kullanmak yerine, boyutları KB seviyesinde olan vektörel <strong>loading animasyonları</strong> kullanmak Core Web Vitals skorlarınızı doğrudan iyileştirir. Bekleme süresini kullanıcılar için katlanılabilir, hatta keyifli hale getiren akıcı mikro etkileşimler dönüşüm oranlarını artırır.
          </p>
        </div>

        <ComponentGrid />
      </div>
    </main>
  );
}
