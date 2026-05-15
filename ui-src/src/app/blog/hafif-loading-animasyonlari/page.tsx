import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Performansı Etkilemeyen Hafif Loading Animasyonları Nasıl Yapılır?",
  description: "Core Web Vitals skorlarınızı koruyarak kullanıcı deneyimini iyileştiren yüksek performanslı loading animasyonları oluşturma ve optimize etme rehberi.",
  alternates: {
    canonical: "https://velikesgin.com/ui/blog/hafif-loading-animasyonlari",
  },
};

export default function BlogPost() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <article className="max-w-3xl mx-auto prose prose-invert prose-pink">
        <h1 className="text-4xl md:text-5xl font-bold mb-6">Performansı Etkilemeyen Hafif Loading Animasyonları</h1>
        <div className="text-white/40 text-sm mb-12">Yayınlanma: 14 Mayıs 2026 | Kategori: Rehber</div>
        
        <p className="text-lg text-white/80">
          Loading animasyonları, uygulamanız arka planda veri çekerken kullanıcıların bekleme hissini azaltır. Ancak yanlış teknoloji seçimi, bu animasyonların uygulamanızın kendisinden bile daha fazla sistem kaynağı tüketmesine neden olabilir.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">En Sık Yapılan Hatalar</h2>
        <ul className="list-disc pl-5 space-y-2 text-white/70">
          <li><strong>GIF Kullanımı:</strong> Ağır, sıkıştırılamayan ve kenarları tırtıklı (aliased) GIF'ler kullanmak web sitenizi yavaşlatır.</li>
          <li><strong>Büyük MP4'ler:</strong> Transparan arka plana ihtiyaç duymayan yüklemeler için bile devasa videolar kullanmak.</li>
          <li><strong>DOM'u Yoran CSS Animasyonları:</strong> Box-shadow, genişlik (width) veya yükseklik (height) gibi özellikleri CSS ile anime etmek tarayıcının sürekli yeniden çizim (repaint) yapmasına neden olur.</li>
        </ul>

        <h2 className="text-2xl font-bold mt-12 mb-4">Doğru Yöntem: Rive veya JSON-LD (Lottie)</h2>
        <p className="mb-6 text-white/70">
          Optimum performans için Lottie JSON veya Rive formatları tercih edilmelidir. Rive, <code>canvas</code> veya <code>WebGL</code> üzerinden render edildiği için DOM ağacını şişirmez ve 60 FPS pürüzsüz animasyon sunar.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">CSS ile Hafif Animasyon Kuralları</h2>
        <p className="mb-6 text-white/70">
          Eğer kendi loading spinner'ınızı CSS ile yazacaksanız, yalnızca GPU donanım hızlandırması (hardware acceleration) destekleyen özellikleri kullanın:
        </p>
        <pre className="bg-white/10 p-4 rounded-xl overflow-x-auto">
          <code className="text-sm font-mono text-pink-300">
{`.spinner {
  /* SADECE BU İKİSİNİ ANİME EDİN */
  transform: rotate(360deg);
  opacity: 0.5;
}`}
          </code>
        </pre>
      </article>
    </main>
  );
}
