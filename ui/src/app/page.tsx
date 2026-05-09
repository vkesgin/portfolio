import Link from "next/link";
import Image from "next/image";
import RiveDemo from "@/components/RiveDemo";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center overflow-hidden bg-black relative">
      {/* Background glowing effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full bg-blue-600/10 blur-[150px] pointer-events-none" />

      {/* Navigation */}
      <nav className="w-full max-w-7xl px-6 py-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <Image src="/logo.webp" alt="vkesgin logo" width={36} height={36} className="rounded-xl object-contain bg-white/5 p-1 border border-white/10" />
          <span className="text-xl font-semibold tracking-tight text-white">vkesgin UI</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
          <Link href="#components" className="hover:text-white transition-colors">Bileşenler</Link>
          <Link href="#pricing" className="hover:text-white transition-colors">Fiyatlandırma</Link>
          <Link href="#faq" className="hover:text-white transition-colors">SSS</Link>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-medium text-zinc-300 hover:text-white transition-colors">
            Giriş Yap
          </Link>
          <Link href="/pricing" className="text-sm font-medium bg-white text-black px-4 py-2 rounded-full hover:bg-zinc-200 transition-colors">
            Pro'ya Geç
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="flex-1 w-full max-w-7xl px-6 flex flex-col items-center justify-center text-center z-10 pt-20 pb-32">
        
        <div className="flex flex-col lg:flex-row items-center justify-between w-full gap-16 lg:text-left text-center">
          
          <div className="flex-1 flex flex-col items-center lg:items-start max-w-2xl">
            <div className="glass px-4 py-1.5 rounded-full mb-8 inline-flex items-center gap-2 text-sm text-zinc-300 border border-white/10 shadow-lg shadow-black/50">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Yeni: Rive v2 Entegrasyonlu Butonlar Yayında
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
              Sıradan UI'lara veda et.<br />
              <span className="text-gradient">Canlı ve Etkileşimli.</span>
            </h1>
            
            <p className="text-lg md:text-xl text-zinc-400 mb-12 leading-relaxed">
              Rive state-machine gücüyle donatılmış, kopyala-yapıştır yapabileceğin premium React bileşenleri. Mikroskobik animasyonlarla kullanıcılarını büyüle.
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              <Link href="/components" className="flex items-center justify-center h-14 px-8 rounded-full bg-primary text-white font-medium text-lg hover:bg-primary/90 transition-all shadow-[0_0_40px_-10px_#FF2B73]">
                Bileşenleri Keşfet
              </Link>
              <Link href="/docs" className="flex items-center justify-center h-14 px-8 rounded-full glass hover:bg-white/5 transition-all text-white font-medium text-lg border border-white/10">
                Dokümantasyonu Oku
              </Link>
            </div>
          </div>

          <div className="flex-1 w-full flex justify-center lg:justify-end">
             <RiveDemo />
          </div>
          
        </div>

        {/* Feature Teaser Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-32 w-full max-w-5xl text-left">
          <div className="glass-card p-6 rounded-2xl">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center mb-4 border border-primary/30">
              <svg className="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Performans Odaklı</h3>
            <p className="text-zinc-400">Rive sayesinde sıfır jank, maksimum 60 FPS akıcılık. Lottie'den %60 daha hafif.</p>
          </div>
          <div className="glass-card p-6 rounded-2xl">
            <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center mb-4 border border-blue-500/30">
              <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">React Uyumlu</h3>
            <p className="text-zinc-400">Props ile yönetilebilen, Tailwind CSS ile stillendirilebilir hazır kod blokları.</p>
          </div>
          <div className="glass-card p-6 rounded-2xl">
            <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center mb-4 border border-orange-500/30">
              <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">Güvenli Erişim</h3>
            <p className="text-zinc-400">Pro bileşen kaynak kodları ve orijinal .riv dosyaları sadece abonelere özeldir.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
