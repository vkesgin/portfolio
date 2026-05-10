import TemplateGrid from "@/components/TemplateGrid";

export default function TemplatesPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Rive ile Güçlendirilmiş Şablonlar
          </h1>
          <p className="text-lg text-white/50 max-w-2xl mx-auto">
            Gelişmiş animasyonları ve kusursuz tasarımı tek bir pakette sunan, hemen kullanıma hazır tam sayfa Next.js şablonları.
          </p>
        </div>

        <TemplateGrid />
      </div>
    </main>
  );
}
