import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Blog | Web ve Mobil Animasyon Rehberi",
  description: "Web ve mobil uygulama geliştiricileri için performanslı animasyon teknikleri, JSON ve Lottie/Rive entegrasyon rehberleri.",
};

const POSTS = [
  {
    slug: "lottie-ve-rive-karsilastirmasi",
    title: "Lottie ve Rive Karşılaştırması: Hangisini Seçmeli?",
    description: "Yeni nesil web ve mobil animasyon araçları Rive ve Lottie'yi performans, dosya boyutu ve interaktif özellikler açısından karşılaştırıyoruz.",
    date: "16 Mayıs 2026",
    category: "Karşılaştırma"
  },
  {
    slug: "hafif-loading-animasyonlari",
    title: "Performansı Etkilemeyen Hafif Loading Animasyonları Nasıl Yapılır?",
    description: "Kullanıcı deneyimini artıran ve Core Web Vitals skorlarını düşürmeyen yüksek performanslı loading (yükleme) animasyonu teknikleri.",
    date: "14 Mayıs 2026",
    category: "Rehber"
  },
  {
    slug: "react-json-animasyon-kullanimi",
    title: "React Projelerinde JSON Animasyonları Nasıl Kullanılır?",
    description: "Next.js ve React projelerinize JSON formatındaki etkileşimli animasyonları en verimli şekilde nasıl ekleyebileceğinizi adım adım öğrenin.",
    date: "12 Mayıs 2026",
    category: "Geliştirici"
  },
  {
    slug: "gif-yerine-json-lottie",
    title: "GIF Yerine Neden Lottie (JSON) Kullanmalısınız?",
    description: "Neden geleneksel ve ağır GIF dosyalarından vazgeçip vektörel, 60 FPS hızında çalışan JSON animasyonlarına geçmelisiniz?",
    date: "10 Mayıs 2026",
    category: "Optimizasyon"
  }
];

export default function BlogIndex() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Animasyon Geliştirme Rehberi</h1>
        <p className="text-white/60 mb-12 text-lg">Web ve mobil uygulamalarınız için en güncel animasyon teknikleri, SEO dostu JSON entegrasyonları ve performans ipuçları.</p>
        
        <div className="grid gap-6">
          {POSTS.map(post => (
            <Link key={post.slug} href={`/blog/${post.slug}`} className="block group bg-white/5 border border-white/10 p-6 rounded-2xl hover:border-[#ff2b73]/50 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-bold px-2 py-1 bg-white/10 rounded-md text-[#ff2b73]">{post.category}</span>
                <span className="text-xs text-white/40">{post.date}</span>
              </div>
              <h2 className="text-2xl font-bold mb-2 group-hover:text-[#ff2b73] transition-colors">{post.title}</h2>
              <p className="text-white/60">{post.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
