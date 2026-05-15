import { Metadata } from "next";

export const metadata: Metadata = {
  title: "GIF Yerine Neden Lottie (JSON) Kullanmalısınız?",
  description: "Ağır ve kalitesiz GIF dosyalarından vazgeçip vektörel, 60 FPS hızında çalışan JSON animasyonlarına geçmeniz için 5 kritik neden.",
  alternates: {
    canonical: "https://velikesgin.com/ui/blog/gif-yerine-json-lottie",
  },
};

export default function BlogPost() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <article className="max-w-3xl mx-auto prose prose-invert prose-pink">
        <h1 className="text-4xl md:text-5xl font-bold mb-6">GIF Yerine Neden Lottie (JSON) Kullanmalısınız?</h1>
        <div className="text-white/40 text-sm mb-12">Yayınlanma: 10 Mayıs 2026 | Kategori: Optimizasyon</div>
        
        <p className="text-lg text-white/80">
          Animasyonlar her yerde: butonlarda, loading ekranlarında, boş sayfa tasarımlarında... Yıllar boyunca tek seçeneğimiz GIF formatıydı. Ancak 2026'da hala GIF kullanmak sitenize büyük bir haksızlıktır. Neden mi?
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">1. Dosya Boyutu ve Performans (Boyut Devrimi)</h2>
        <p className="mb-6 text-white/70">
          Tipik bir kaliteli GIF dosyası 2-5 MB boyutlarındadır. Aynı animasyonu Lottie (JSON) formatında yaptığınızda bu boyut genellikle <strong>20 KB ile 50 KB</strong> arasına düşer. Siteniz %90 daha hızlı yüklenir, Core Web Vitals skorunuz tavan yapar.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">2. Vektörel Kusursuzluk (Pikselleşmeye Son)</h2>
        <p className="mb-6 text-white/70">
          GIF raster (piksel) tabanlıdır. Ekranı büyüttüğünüzde, retina bir cihazda (iPhone, Macbook) görüntü bulanıklaşır ve piksellenir. JSON tabanlı Lottie ve Rive dosyaları ise tamamen vektöreldir. Animasyonu billboard boyutuna da büyütseniz kalitesinden zerre ödün vermez.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">3. Etkileşim Eksikliği (Statik vs Dinamik)</h2>
        <p className="mb-6 text-white/70">
          Bir GIF animasyonunu başlatıp durduramazsınız. Kullanıcı faresiyle butonun üzerine geldiğinde (hover) farklı, tıkladığında (click) farklı tepki vermesini sağlayamazsınız. Rive veya Lottie kullanarak kullanıcı tetikleyicilerine (trigger) bağlı oyun gibi tepkiler verebilen animasyonlar üretebilirsiniz.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">4. Transparan Arka Plan Sorunu</h2>
        <p className="text-white/70">
          GIF formatı tam transparanlığı (alpha channel) mükemmel şekilde desteklemez. Etrafında "beyaz haleler" (white fringes) oluşur. JSON tabanlı web animasyonları ise şeffaf arka planlarda kusursuz, jilet gibi keskin bir görünüm sunar. Artık o çirkin beyaz kenarlıklara veda edin.
        </p>
      </article>
    </main>
  );
}
