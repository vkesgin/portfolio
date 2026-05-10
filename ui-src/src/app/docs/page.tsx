import Link from "next/link";

export default function DocsPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-12">
        {/* Sidebar */}
        <aside className="w-full md:w-64 flex-shrink-0">
          <div className="sticky top-32">
            <h3 className="font-bold text-lg mb-4 text-[#ff2b73]">Başlangıç</h3>
            <ul className="space-y-3 text-white/60">
              <li><a href="#kurulum" className="hover:text-white transition-colors">Kurulum & Paketler</a></li>
              <li><a href="#kullanim" className="hover:text-white transition-colors">Bileşen Kullanımı</a></li>
              <li><a href="#state-machine" className="hover:text-white transition-colors">State Machine Nedir?</a></li>
            </ul>

            <h3 className="font-bold text-lg mt-10 mb-4 text-[#ff2b73]">İleri Seviye</h3>
            <ul className="space-y-3 text-white/60">
              <li><a href="#viewmodel" className="hover:text-white transition-colors">ViewModel Veri Bağlama</a></li>
              <li><a href="#edit" className="hover:text-white transition-colors">Rive Dosyalarını Düzenleme</a></li>
            </ul>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 space-y-16">
          <div>
            <h1 className="text-4xl font-bold tracking-tight mb-4">Nasıl Kullanılır?</h1>
            <p className="text-xl text-white/50 leading-relaxed">
              VK UI bileşenlerini React projelerinize entegre etmek sadece birkaç dakikanızı alır.
            </p>
          </div>

          <section id="kurulum">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ff2b73]/20 text-[#ff2b73] text-sm">1</span>
              Gerekli Paketleri Kurun
            </h2>
            <p className="text-white/60 mb-4">
              Bileşenlerimiz resmi Rive React kütüphanelerini kullanır. Projenize WebGL2 destekli Rive kütüphanesini ekleyin:
            </p>
            <div className="bg-black/50 border border-white/10 rounded-xl p-4 font-mono text-sm text-[#ff2b73] mb-4">
              npm install @rive-app/react-webgl2 @rive-app/canvas
            </div>
            <p className="text-sm text-white/40">
              * Not: WebGL2 render motoru, ViewModel veri bağlama ve hover gibi yerel dinleyicilerin (native listeners) kusursuz çalışması için zorunludur.
            </p>
          </section>

          <section id="kullanim">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ff2b73]/20 text-[#ff2b73] text-sm">2</span>
              Bileşeni Projenize Ekleyin
            </h2>
            <p className="text-white/60 mb-4">
              Beğendiğiniz bileşenin kaynak kodunu kopyalayın ve projenizde yeni bir bileşen oluşturun (Örn: <code>JumpingCar.tsx</code>). Ardından indirdiğiniz <code>.riv</code> dosyasını `public` klasörünüze koyun.
            </p>
            <div className="bg-black/50 border border-white/10 rounded-xl p-6 font-mono text-sm text-white/80 overflow-x-auto leading-relaxed">
              <pre>{`import { useRive } from "@rive-app/react-webgl2";

export default function JumpingCar() {
  const { RiveComponent } = useRive({
    src: "/vehicles.riv",
    stateMachines: "bumpy", // Etkileşim için zorunlu
    autoplay: true,
  });

  return (
    <div className="w-64 h-64">
      <RiveComponent />
    </div>
  );
}`}</pre>
            </div>
          </section>

          <section id="state-machine">
            <h2 className="text-2xl font-bold mb-6">State Machine (Durum Makinesi) Nedir?</h2>
            <p className="text-white/60 leading-relaxed mb-4">
              Rive animasyonları sıradan videolardan veya Lottie dosyalarından farklıdır. İçlerinde <strong>State Machine</strong> adını verdiğimiz bir mantık katmanı barındırırlar.
            </p>
            <ul className="list-disc list-inside text-white/60 space-y-2 mb-6">
              <li>Bir butona tıklanıldığını (Trigger)</li>
              <li>Mouse'un ekranın neresinde olduğunu (Number - x,y)</li>
              <li>Karanlık modun açık olup olmadığını (Boolean)</li>
            </ul>
            <p className="text-white/60 leading-relaxed">
              anlayabilir ve animasyonu buna göre anlık olarak değiştirebilirler. Kütüphanemizdeki kodları kopyaladığınızda, ilgili bileşenin State Machine etkileşimleri otomatik olarak kodun içine dahil edilmiştir.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
