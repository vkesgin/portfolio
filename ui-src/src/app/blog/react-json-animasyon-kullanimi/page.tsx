import { Metadata } from "next";

export const metadata: Metadata = {
  title: "React Projelerinde JSON Animasyonları Nasıl Kullanılır?",
  description: "Next.js ve React projelerinize JSON formatındaki etkileşimli animasyonları en verimli şekilde nasıl ekleyebileceğinizi adım adım öğrenin.",
  alternates: {
    canonical: "https://velikesgin.com/ui/blog/react-json-animasyon-kullanimi",
  },
};

export default function BlogPost() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <article className="max-w-3xl mx-auto prose prose-invert prose-pink">
        <h1 className="text-4xl md:text-5xl font-bold mb-6">React Projelerinde JSON Animasyonları Nasıl Kullanılır?</h1>
        <div className="text-white/40 text-sm mb-12">Yayınlanma: 12 Mayıs 2026 | Kategori: Geliştirici</div>
        
        <p className="text-lg text-white/80">
          React ekosisteminde animasyon kullanmanın en optimize yollarından biri JSON tabanlı Lottie dosyaları kullanmaktır. Bu rehberde, React ve Next.js'te animasyonların nasıl sorunsuz ekleneceğine bakacağız.
        </p>

        <h2 className="text-2xl font-bold mt-12 mb-4">Lottie-React Kurulumu</h2>
        <p className="mb-6 text-white/70">
          En popüler kütüphane olan <code>lottie-react</code> kullanarak başlayalım:
        </p>
        <pre className="bg-white/10 p-4 rounded-xl overflow-x-auto mb-6">
          <code className="text-sm font-mono text-pink-300">
            npm install lottie-react
          </code>
        </pre>

        <h2 className="text-2xl font-bold mt-12 mb-4">Temel Kullanım Örneği</h2>
        <pre className="bg-white/10 p-4 rounded-xl overflow-x-auto">
          <code className="text-sm font-mono text-pink-300">
{`import Lottie from "lottie-react";
import animationData from "./loading-animation.json";

export default function LoadingScreen() {
  return (
    <div style={{ width: 200, height: 200 }}>
      <Lottie animationData={animationData} loop={true} />
    </div>
  );
}`}
          </code>
        </pre>

        <h2 className="text-2xl font-bold mt-12 mb-4">Next.js ve SSR Optimizasyonu</h2>
        <p className="text-white/70 mb-6">
          Lottie-react kütüphanesi tarayıcı tabanlı çalıştığı için Next.js'in App Router yapısında (Server Components) doğrudan render edilemez. Animasyonu sarmalayan component'in en üstüne mutlaka <code>"use client"</code> eklemelisiniz.
        </p>
        
        <h2 className="text-2xl font-bold mt-12 mb-4">Daha Hızlı Bir Alternatif: Rive</h2>
        <p className="text-white/70">
          Eğer uygulamanız çok fazla animasyon içeriyorsa, JSON tabanlı Lottie dosyalarının boyutu ve RAM tüketimi artabilir. Sitemizde sunduğumuz <strong>Rive</strong> (.riv) animasyonları, React içinde <code>@rive-app/react-canvas</code> ile hem daha az bellek tüketir hem de durum makinesi (state machine) ile tıklama ve hover gibi etkileşimleri native olarak destekler.
        </p>
      </article>
    </main>
  );
}
