import { Metadata } from "next";
import ComponentGrid from "@/components/ComponentGrid";

export const metadata: Metadata = {
  title: "Mobil Uygulama Animasyonları & UI Uyumlu Tasarımlar",
  description: "iOS ve Android projeleriniz için native uyumlu Rive ve JSON tabanlı mobil uygulama animasyonları. Hemen indirin.",
  alternates: {
    canonical: "https://velikesgin.com/ui/animasyonlar/mobil-uygulama",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Mobil Uygulama UI Animasyonları",
  "operatingSystem": "iOS, Android, React Native, Flutter",
  "applicationCategory": "DeveloperApplication",
  "description": "Mobil geliştiriciler için özel olarak optimize edilmiş hafif etkileşimli animasyonlar."
};

export default function MobilUygulamaAnimasyonPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Mobil Uygulama Animasyonları
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            React Native, Flutter, Swift ve Kotlin projelerinizle %100 uyumlu, 60FPS akıcılığında çalışan etkileşimli UI animasyonları.
          </p>
        </div>

        <div className="max-w-4xl mx-auto mb-16 p-6 rounded-2xl bg-white/5 border border-white/10">
          <h2 className="text-2xl font-bold mb-4">Uygulama Uyumlu Animasyonlar Nasıl Çalışır?</h2>
          <p className="text-white/70 mb-4">
            Geleneksel web animasyonlarından farklı olarak, mobil animasyonlar (örneğin state machine tabanlı Rive dosyaları) cihazın GPU'sunu kullanarak native performans sunar. Kullanıcının dokunma (tap) ve kaydırma (swipe) hareketlerine anlık tepki vererek uygulamaya "premium" bir his kazandırır.
          </p>
        </div>

        <ComponentGrid />
      </div>
    </main>
  );
}
