import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lottie ve Rive Karşılaştırması: Hangi Format Daha İyi?",
  description: "Web ve mobil animasyonlarda lider iki format: Lottie (JSON) ve Rive. Performans, dosya boyutu, etkileşim (state machine) ve kullanım kolaylığını karşılaştırıyoruz.",
  alternates: {
    canonical: "https://velikesgin.com/ui/blog/lottie-ve-rive-karsilastirmasi",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Lottie ve Rive Karşılaştırması: Hangi Format Daha İyi?",
  "datePublished": "2026-05-16",
  "author": {
    "@type": "Person",
    "name": "Veli Kesgin"
  },
  "description": "Lottie (JSON) ve Rive formatlarının performans ve kullanım kolaylığı açısından detaylı karşılaştırması."
};

export default function BlogPost() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article className="max-w-3xl mx-auto prose prose-invert prose-pink">
        <h1 className="text-4xl md:text-5xl font-bold mb-6">Lottie ve Rive Karşılaştırması: Hangisini Seçmeli?</h1>
        <div className="text-white/40 text-sm mb-12">Yayınlanma: 16 Mayıs 2026 | Kategori: Karşılaştırma</div>
        
        <p className="text-lg text-white/80">
          <strong>Özet:</strong> Lottie (JSON), After Effects üzerinden dışa aktarılan popüler ve yaygın bir formattır; harika animasyonlar sunar ancak statiktir. Rive ise kendi editörüyle tasarlanan, "State Machine" (Durum Makinesi) sayesinde kullanıcının hareketlerine anlık tepki veren çok daha hafif ve tamamen interaktif bir formattır.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">Lottie Nedir?</h2>
        <p className="mb-6 text-white/70">
          Airbnb tarafından geliştirilen Lottie, Adobe After Effects animasyonlarını Bodymovin eklentisiyle <code>.json</code> formatında dışa aktarmanızı sağlar. En büyük avantajı, tasarımcıların zaten bildiği After Effects programını kullanmasıdır.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">Rive Nedir?</h2>
        <p className="mb-6 text-white/70">
          Rive, doğrudan interaktif animasyonlar üretmek için tasarlanmış bağımsız bir araçtır. Çıktı olarak <code>.riv</code> formatını kullanır. En büyük özelliği, kod yazmadan animasyonlara mantık (mantıksal durumlar, hover, click etkileşimleri) ekleyebilmenizdir.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">Detaylı Karşılaştırma (Tablo)</h2>
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-left border-collapse border border-white/10">
            <thead>
              <tr className="bg-white/5">
                <th className="p-4 border border-white/10">Özellik</th>
                <th className="p-4 border border-white/10">Lottie (JSON)</th>
                <th className="p-4 border border-white/10">Rive (.riv)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-4 border border-white/10">Dosya Boyutu</td>
                <td className="p-4 border border-white/10">Orta/Yüksek (Yüzlerce KB)</td>
                <td className="p-4 border border-white/10">Çok Düşük (Genelde 5-20 KB)</td>
              </tr>
              <tr>
                <td className="p-4 border border-white/10">Etkileşim (Interactivity)</td>
                <td className="p-4 border border-white/10">Sınırlı (Sadece play, pause, reverse)</td>
                <td className="p-4 border border-white/10">Gelişmiş (State Machine ile Limitsiz)</td>
              </tr>
              <tr>
                <td className="p-4 border border-white/10">Tasarım Aracı</td>
                <td className="p-4 border border-white/10">After Effects (Ağır & Pahalı)</td>
                <td className="p-4 border border-white/10">Rive Editor (Tarayıcı tabanlı & Ücretsiz başla)</td>
              </tr>
              <tr>
                <td className="p-4 border border-white/10">Ekosistem/Topluluk</td>
                <td className="p-4 border border-white/10">Çok Geniş (Milyonlarca hazır dosya)</td>
                <td className="p-4 border border-white/10">Büyüyor</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 className="text-2xl font-bold mt-12 mb-4">Sonuç</h2>
        <p className="text-white/70">
          Eğer sadece basit bir loading animasyonu veya arka planda dönecek statik bir hareket arıyorsanız, Lottie'nin devasa kütüphanesini kullanabilirsiniz. Ancak uygulamanızda "fareyi takip eden karakter", "tıklandığında şekil değiştiren buton" gibi <strong>oyun benzeri dinamik etkileşimler</strong> ve maksimum performans arıyorsanız, Rive kesinlikle geleceğin standardıdır.
        </p>
      </article>
    </main>
  );
}
