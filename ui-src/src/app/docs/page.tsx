"use client";

import React, { useState } from "react";
import Link from "next/link";

const platforms = [
  { id: "react", label: "React / Next.js" },
  { id: "framer", label: "Framer" },
  { id: "wix", label: "Wix Studio" },
  { id: "wordpress", label: "WordPress" },
  { id: "webflow", label: "Webflow" },
  { id: "html", label: "HTML / Vanilla JS" },
  { id: "unity", label: "Unity (C#)" },
  { id: "android", label: "Android (Java/Kotlin)" },
];

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group bg-black/60 border border-white/10 rounded-xl p-5 font-mono text-sm text-white/80 overflow-x-auto leading-relaxed mb-4">
      <button onClick={copy} className="absolute top-3 right-3 text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg transition-colors text-white/60 hover:text-white">
        {copied ? "Kopyalandı ✓" : "Kopyala"}
      </button>
      <pre>{code}</pre>
    </div>
  );
}

function SectionTitle({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold mb-6 flex items-center gap-3">
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[#ff2b73]/20 text-[#ff2b73] text-sm font-bold">{step}</span>
      {children}
    </h2>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4 bg-[#ff2b73]/5 border border-[#ff2b73]/20 rounded-xl text-sm text-white/70 mb-6">
      <span className="text-[#ff2b73] text-lg mt-[-2px]">💡</span>
      <div>{children}</div>
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl text-sm text-white/70 mb-6">
      <span className="text-yellow-400 text-lg mt-[-2px]">⚠️</span>
      <div>{children}</div>
    </div>
  );
}

/* ───── PLATFORM GUIDES ───── */

function ReactGuide() {
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle step={1}>Rive Kütüphanesini Kurun</SectionTitle>
        <p className="text-white/60 mb-4">React veya Next.js projenizde terminal açın ve aşağıdaki komutu çalıştırın:</p>
        <CodeBlock code="npm install @rive-app/react-webgl2" />
        <Tip>WebGL2 sürümünü kullanmanız gerekir. <code className="text-[#ff2b73]">@rive-app/react-canvas</code> sürümü hover gibi native listener etkileşimlerini desteklemez.</Tip>
      </section>

      <section>
        <SectionTitle step={2}>.riv Dosyasını Projeye Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">İndirdiğiniz <code className="text-[#ff2b73]">.riv</code> dosyasını projenizin <code className="text-[#ff2b73]">public/</code> klasörüne kopyalayın:</p>
        <CodeBlock code={`my-project/
├── public/
│   └── button-hover.riv   ← buraya koyun
├── src/
│   └── components/
│       └── RiveButton.tsx  ← bileşen dosyası
└── package.json`} />
      </section>

      <section>
        <SectionTitle step={3}>Bileşen Kodunu Oluşturun</SectionTitle>
        <p className="text-white/60 mb-4">Kütüphanemizden kopyaladığınız kodu yeni bir <code className="text-[#ff2b73]">.tsx</code> dosyasına yapıştırın:</p>
        <CodeBlock lang="tsx" code={`import { useRive } from "@rive-app/react-webgl2";

export default function RiveButton() {
  const { RiveComponent } = useRive({
    src: "/button-hover.riv",
    stateMachines: "State Machine 1",
    autoplay: true,
  });

  return (
    <div style={{ width: 300, height: 120 }}>
      <RiveComponent />
    </div>
  );
}`} />
        <Warning><strong>stateMachines</strong> değeri bileşenin sayfasında yazan değerle birebir aynı olmalıdır. Yanlış yazarsanız animasyon oynar ama etkileşimler çalışmaz.</Warning>
      </section>

      <section>
        <SectionTitle step={4}>Sayfanızda Kullanın</SectionTitle>
        <CodeBlock lang="tsx" code={`import RiveButton from "@/components/RiveButton";

export default function HomePage() {
  return (
    <main>
      <h1>Hoş Geldiniz</h1>
      <RiveButton />
    </main>
  );
}`} />
        <Tip>Next.js App Router kullanıyorsanız, Rive bileşenlerinizin en üstüne <code className="text-[#ff2b73]">"use client";</code> eklemeyi unutmayın.</Tip>
      </section>
    </div>
  );
}

function WordPressGuide() {
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle step={1}>.riv Dosyasını Yükleyin</SectionTitle>
        <p className="text-white/60 mb-4">WordPress yönetici panelinize girin → <strong>Medya → Yeni Ekle</strong> ile <code className="text-[#ff2b73]">.riv</code> dosyasını yükleyin.</p>
        <Warning>WordPress varsayılan olarak <code>.riv</code> uzantısını engelleyebilir. Bu durumda <code className="text-[#ff2b73]">functions.php</code> dosyanıza şu kodu ekleyin:</Warning>
        <CodeBlock lang="php" code={`// functions.php dosyanıza ekleyin
function allow_riv_upload( $mimes ) {
    $mimes['riv'] = 'application/octet-stream';
    return $mimes;
}
add_filter( 'upload_mimes', 'allow_riv_upload' );`} />
        <p className="text-white/60 mb-4">Yükleme tamamlandıktan sonra dosyanın URL'sini kopyalayın. Örn: <code className="text-[#ff2b73]">https://siteadresiniz.com/wp-content/uploads/2026/05/button.riv</code></p>
      </section>

      <section>
        <SectionTitle step={2}>Rive Runtime Kodunu Sayfaya Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4"><strong>Görünüm → Tema Dosya Düzenleyicisi → header.php</strong> dosyasının <code className="text-[#ff2b73]">&lt;/head&gt;</code> etiketinin hemen üstüne ekleyin:</p>
        <CodeBlock lang="html" code={`<script src="https://unpkg.com/@rive-app/canvas@latest"></script>`} />
      </section>

      <section>
        <SectionTitle step={3}>Sayfanıza Canvas Bloğu Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">Gutenberg editöründe <strong>"Özel HTML"</strong> bloğu ekleyip aşağıdaki kodu yapıştırın:</p>
        <CodeBlock lang="html" code={`<canvas id="rive-button" width="300" height="120"
  style="display:block; margin:0 auto;"></canvas>

<script>
  const r = new rive.Rive({
    src: "https://siteadresiniz.com/wp-content/uploads/2026/05/button.riv",
    canvas: document.getElementById("rive-button"),
    stateMachines: "State Machine 1",
    autoplay: true,
    onLoad: () => r.resizeDrawingSurfaceToCanvas(),
  });
</script>`} />
        <Tip><code>src</code> kısmına 1. adımda kopyaladığınız medya URL'sini yapıştırın. <code>stateMachines</code> değerini bileşen sayfasından alın.</Tip>
      </section>

      <section>
        <SectionTitle step={4}>Elementor / WPBakery Kullanıyorsanız</SectionTitle>
        <p className="text-white/60 mb-4">Elementor'da <strong>"HTML"</strong> widget'ı, WPBakery'de <strong>"Raw HTML"</strong> elementi kullanarak 3. adımdaki aynı kodu yapıştırabilirsiniz. Kod birebir aynı şekilde çalışacaktır.</p>
      </section>
    </div>
  );
}

function WebflowGuide() {
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle step={1}>.riv Dosyasını Webflow'a Yükleyin</SectionTitle>
        <p className="text-white/60 mb-4"><strong>Assets Panel → Upload</strong> ile <code className="text-[#ff2b73]">.riv</code> dosyasını yükleyin ve dosya URL'sini kopyalayın.</p>
        <Tip>Webflow <code>.riv</code> formatını tanımazsa, dosyayı bir CDN'e (örn: Cloudflare R2, AWS S3) yükleyip oradan URL alabilirsiniz.</Tip>
      </section>

      <section>
        <SectionTitle step={2}>Rive Runtime'ı Projeye Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4"><strong>Project Settings → Custom Code → Head Code</strong> alanına ekleyin:</p>
        <CodeBlock lang="html" code={`<script src="https://unpkg.com/@rive-app/canvas@latest"></script>`} />
      </section>

      <section>
        <SectionTitle step={3}>Canvas Embed Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">Sayfanızda <strong>Embed</strong> elementi ekleyin ve içine:</p>
        <CodeBlock lang="html" code={`<canvas id="rive-anim" width="400" height="400"
  style="width:100%; max-width:400px; height:auto; aspect-ratio:1/1;">
</canvas>

<script>
  const r = new rive.Rive({
    src: "DOSYA_URL_BURAYA",
    canvas: document.getElementById("rive-anim"),
    stateMachines: "State Machine 1",
    autoplay: true,
    onLoad: () => r.resizeDrawingSurfaceToCanvas(),
  });
</script>`} />
      </section>

      <section>
        <SectionTitle step={4}>Responsive Ayarları</SectionTitle>
        <p className="text-white/60 mb-4">Canvas'ın responsive olması için stil ayarlarını şu şekilde yapın:</p>
        <CodeBlock lang="css" code={`#rive-anim {
  width: 100%;
  max-width: 400px;
  height: auto;
  aspect-ratio: 1 / 1;
}`} />
      </section>
    </div>
  );
}

function HtmlGuide() {
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle step={1}>Rive JS Runtime'ı Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">HTML dosyanızın <code className="text-[#ff2b73]">&lt;head&gt;</code> bölümüne:</p>
        <CodeBlock lang="html" code={`<script src="https://unpkg.com/@rive-app/canvas@latest"></script>`} />
      </section>

      <section>
        <SectionTitle step={2}>Canvas Elementi Oluşturun</SectionTitle>
        <CodeBlock lang="html" code={`<canvas id="my-rive" width="500" height="500"></canvas>`} />
      </section>

      <section>
        <SectionTitle step={3}>Rive'ı Başlatın</SectionTitle>
        <CodeBlock lang="html" code={`<script>
  const riveInstance = new rive.Rive({
    src: "/assets/animation.riv",
    canvas: document.getElementById("my-rive"),
    stateMachines: "State Machine 1",
    autoplay: true,
    onLoad: () => {
      riveInstance.resizeDrawingSurfaceToCanvas();
    },
  });

  // Pencere boyutu değiştiğinde yeniden boyutla
  window.addEventListener("resize", () => {
    riveInstance.resizeDrawingSurfaceToCanvas();
  });
</script>`} />
        <Tip>Birden fazla animasyon kullanacaksanız her biri için ayrı <code className="text-[#ff2b73]">canvas</code> ve ayrı <code className="text-[#ff2b73]">Rive</code> instance'ı oluşturun.</Tip>
      </section>
    </div>
  );
}

function UnityGuide() {
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle step={1}>Rive Unity Package'ı Kurun</SectionTitle>
        <p className="text-white/60 mb-4">Unity editöründe <strong>Window → Package Manager → Add package from git URL</strong> seçeneğine tıklayın:</p>
        <CodeBlock code="https://github.com/rive-app/rive-unity.git" />
        <Warning>Unity <strong>2022.3 LTS</strong> veya üstü gereklidir. Eski sürümlerde derleme hataları alabilirsiniz.</Warning>
      </section>

      <section>
        <SectionTitle step={2}>.riv Dosyasını İçe Aktarın</SectionTitle>
        <p className="text-white/60 mb-4">İndirdiğiniz <code className="text-[#ff2b73]">.riv</code> dosyasını <strong>Assets</strong> klasörüne sürükleyin. Unity dosyayı otomatik olarak bir <strong>Rive Asset</strong> olarak tanıyacaktır.</p>
      </section>

      <section>
        <SectionTitle step={3}>Sahneye Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">Bir UI Canvas veya RawImage objesine <strong>RiveScreen</strong> component'ini ekleyin:</p>
        <CodeBlock lang="csharp" code={`using Rive;
using UnityEngine;

public class RiveAnimation : MonoBehaviour
{
    public RiveAsset riveAsset;  // Inspector'dan .riv dosyasını atayın

    private RiveScreen riveScreen;

    void Start()
    {
        riveScreen = GetComponent<RiveScreen>();
        riveScreen.Asset = riveAsset;

        // State Machine'i başlat
        var sm = riveScreen.StateMachine;
        if (sm != null)
        {
            Debug.Log("State Machine yüklendi: " + sm.Name);
        }
    }
}`} />
      </section>

      <section>
        <SectionTitle step={4}>Etkileşim Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">Mouse tıklamasıyla trigger tetiklemek için:</p>
        <CodeBlock lang="csharp" code={`void Update()
{
    if (Input.GetMouseButtonDown(0))
    {
        var trigger = riveScreen.StateMachine?
            .GetTrigger("clicked");
        trigger?.Fire();
    }
}`} />
        <Tip>Trigger, Boolean ve Number input isimlerini bileşen sayfasındaki State Machine bilgilerinden öğrenebilirsiniz.</Tip>
      </section>
    </div>
  );
}

function AndroidGuide() {
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle step={1}>Gradle Bağımlılığını Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">Modül seviyesindeki <code className="text-[#ff2b73]">build.gradle</code> dosyanıza:</p>
        <CodeBlock lang="groovy" code={`dependencies {
    implementation "app.rive:rive-android:9.+"
    // Kotlin kullanıyorsanız:
    // implementation "app.rive:rive-android-kotlin:9.+"
}`} />
      </section>

      <section>
        <SectionTitle step={2}>.riv Dosyasını Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">Dosyayı <code className="text-[#ff2b73]">res/raw/</code> klasörüne koyun:</p>
        <CodeBlock code={`app/
└── src/main/
    └── res/
        └── raw/
            └── button_hover.riv`} />
      </section>

      <section>
        <SectionTitle step={3}>Layout XML'e Ekleyin</SectionTitle>
        <CodeBlock lang="xml" code={`<app.rive.runtime.core.RiveAnimationView
    android:id="@+id/rive_view"
    android:layout_width="300dp"
    android:layout_height="120dp"
    app:rivResource="@raw/button_hover"
    app:riveStateMachine="State Machine 1"
    app:riveAutoPlay="true" />`} />
      </section>

      <section>
        <SectionTitle step={4}>Java ile Etkileşim</SectionTitle>
        <CodeBlock lang="java" code={`RiveAnimationView riveView = findViewById(R.id.rive_view);

// Trigger tetikleme
riveView.fireState("State Machine 1", "clicked");

// Boolean değer ayarlama
riveView.setBooleanState(
    "State Machine 1", "isHovered", true
);

// Number değer ayarlama
riveView.setNumberState(
    "State Machine 1", "progress", 0.75f
);`} />
        <Tip>Kotlin kullanıyorsanız aynı API'ler geçerlidir, yalnızca syntax farkı vardır.</Tip>
      </section>
    </div>
  );
}

function FramerGuide() {
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle step={1}>Framer Projenizi Açın</SectionTitle>
        <p className="text-white/60 mb-4">Framer üzerinde çalıştığınız projenizde yeni bir <strong>Code Component</strong> oluşturmanız gerekecek. Framer'ın kod bileşenleri React tabanlı olduğu için entegrasyon oldukça basittir.</p>
      </section>

      <section>
        <SectionTitle step={2}>Code Component Oluşturun</SectionTitle>
        <p className="text-white/60 mb-4">Framer arayüzünde <strong>Assets {'>'} Code {'>'} Component</strong> yolunu izleyip yeni bir bileşen oluşturun (Örneğin: <code className="text-[#ff2b73]">RiveAnimation</code>).</p>
      </section>

      <section>
        <SectionTitle step={3}>Bileşen Kodunu Ekleyin</SectionTitle>
        <p className="text-white/60 mb-4">Oluşturduğunuz bileşenin içeriğine aşağıdaki React kodunu yapıştırın. Bu kod, Rive kütüphanesini dışarıdan yükleyerek çalıştırır:</p>
        <CodeBlock lang="tsx" code={`import React from "react"
import { useRive } from "@rive-app/react-webgl2"

// URL kısmını kütüphanemizden indirdiğiniz veya sunucunuza yüklediğiniz .riv linki ile değiştirin
export default function RiveAnimation(props) {
  const { RiveComponent } = useRive({
    src: "https://siteadresiniz.com/animasyon.riv",
    stateMachines: "State Machine 1", // Rive dosyanızdaki State Machine adı
    autoplay: true,
  })

  return (
    <div style={{ width: props.width || "100%", height: props.height || "100%" }}>
      <RiveComponent />
    </div>
  )
}`} />
        <Tip>Framer'da yerel bir <code>.riv</code> dosyasını doğrudan Asset olarak yüklemek her zaman desteklenmeyebilir. Dosyanızı bir CDN veya sunucuya yükleyip URL olarak vermek en garanti yöntemdir.</Tip>
      </section>
      
      <section>
        <SectionTitle step={4}>Ticari Projelerinizde Kullanın</SectionTitle>
        <p className="text-white/60 mb-4">Bileşeni sayfaya sürükleyip bıraktığınızda, hover ve click gibi State Machine trigger'ları doğrudan Framer preview modunda çalışmaya başlayacaktır.</p>
      </section>
    </div>
  );
}

function WixStudioGuide() {
  return (
    <div className="space-y-10">
      <section>
        <SectionTitle step={1}>Wix Studio Özel Öğe (Custom Element) Ekleme</SectionTitle>
        <p className="text-white/60 mb-4">Wix Studio editöründe <strong>Ekle (+) {'>'} Göm ve Paylaş {'>'} Özel Öğe (Custom Element)</strong> sürükleyerek sayfanıza ekleyin.</p>
      </section>

      <section>
        <SectionTitle step={2}>.riv Dosyasını Yükleyin</SectionTitle>
        <p className="text-white/60 mb-4">Wix Medya Yöneticisine <code className="text-[#ff2b73]">.riv</code> dosyanızı yükleyin ve ardından dosyanın genel URL'sini (Public URL) kopyalayın.</p>
      </section>

      <section>
        <SectionTitle step={3}>Kod Bağlantısını Yapın</SectionTitle>
        <p className="text-white/60 mb-4">Özel öğeyi seçip "Kod Seç" alanına tıklayın. "Velo dosyası" veya "Sunucu dosyası" seçeneği ile aşağıdaki kodu içeren bir JavaScript dosyası bağlayın:</p>
        <CodeBlock lang="javascript" code={`// Rive CDN üzerinden yüklenir
import * as rive from 'https://unpkg.com/@rive-app/canvas@latest';

class RiveElement extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<canvas id="rive-canvas" width="400" height="400" style="width: 100%; height: 100%;"></canvas>';
    
    const r = new rive.Rive({
      src: "KOPYALADIGINIZ_RIV_DOSYASI_URLSI",
      canvas: this.querySelector('#rive-canvas'),
      stateMachines: "State Machine 1", // Dosyaya ait etkileşim adı
      autoplay: true,
      onLoad: () => r.resizeDrawingSurfaceToCanvas(),
    });
  }
}
customElements.define('rive-animation', RiveElement);`} />
        <Warning>Wix Studio içerisinde <code>customElements.define</code> ile etiket ismini belirlerken Özel Öğe ayarlarındaki "Etiket Adı" ile birebir aynı olmasına dikkat edin.</Warning>
      </section>

      <section>
        <SectionTitle step={4}>Yayınlayın ve Test Edin</SectionTitle>
        <p className="text-white/60 mb-4">Wix sitenizi yayınladığınızda animasyonlarınız %100 sorunsuz şekilde etkileşimli olarak (hover, click vb.) çalışacaktır. Üstelik PRO pakette sunduğumuz %100 Ticari Kullanım İzni sayesinde müşteri sitelerinde özgürce satabilirsiniz.</p>
      </section>
    </div>
  );
}

const guideMap: Record<string, () => React.ReactNode> = {
  react: ReactGuide,
  framer: FramerGuide,
  wix: WixStudioGuide,
  wordpress: WordPressGuide,
  webflow: WebflowGuide,
  html: HtmlGuide,
  unity: UnityGuide,
  android: AndroidGuide,
};

export default function DocsPage() {
  const [activePlatform, setActivePlatform] = useState("react");
  const Guide = guideMap[activePlatform];

  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-5xl mx-auto">
        {/* Header - SEO Optimizasyonu ve Karşılama */}
        <div className="mb-12 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Rive Dosyası Nasıl Çalıştırılır? & Entegrasyon Kılavuzu
          </h1>
          <p className="text-xl text-white/70 leading-relaxed max-w-3xl mb-6">
            VK UI platformundan indirdiğiniz <strong>hazır web animasyonları</strong> ve <strong>ücretsiz / ücretli Rive (.riv) şablonlarını</strong> projelerinize nasıl dahil edeceğinizi öğrenin. React, Next.js, Framer, Wix Studio, Webflow ve WordPress gibi tüm modern arayüzleri destekliyoruz.
          </p>
          <div className="flex flex-wrap gap-3 mb-6 items-center md:justify-start justify-center">
            <span className="px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full text-sm font-semibold">Tüm Şablonlar %100 Ticari Kullanıma Uygundur</span>
            <span className="px-3 py-1 bg-[#ff2b73]/10 text-[#ff2b73] border border-[#ff2b73]/20 rounded-full text-sm font-semibold">Aylık Sınırsız İndirme (PRO)</span>
            <span className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-sm font-semibold text-white/70">Ücretsiz Rive Şablonları</span>
          </div>
          <p className="text-base text-white/50 leading-relaxed max-w-4xl">
            İster yapay zeka destekli bir uygulama, ister kurumsal bir SaaS, isterseniz de bir e-ticaret arayüzü geliştiriyor olun. Rive dosyalarını entegre etmek saniyeler sürer. Müşteri projelerinizde (Ticari amaçla) güvenle kullanabilir, web sitelerinizin kullanıcı deneyimini (UI/UX) muazzam seviyede artırabilirsiniz. 
          </p>
        </div>

        {/* Platform Tabs */}
        <div className="flex flex-wrap gap-2 mb-12 p-1.5 bg-white/5 border border-white/10 rounded-2xl">
          {platforms.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePlatform(p.id)}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activePlatform === p.id
                  ? "bg-[#ff2b73] text-white shadow-lg shadow-[#ff2b73]/20"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Guide Content */}
        <div className="bg-white/[0.02] border border-white/10 rounded-3xl p-8 md:p-12">
          <Guide />
        </div>

        {/* Access Info */}
        <div className="mt-16 grid md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl border border-white/10 bg-white/5">
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <span className="text-green-400">●</span> Ücretsiz Üyelik
            </h3>
            <ul className="space-y-2 text-white/60 text-sm">
              <li>✓ Ücretsiz bileşenlerin .riv dosyalarını indirme</li>
              <li>✓ Ücretsiz bileşenlerin React kaynak kodları</li>
              <li>✓ Aylık 5 indirme hakkı (her ay yenilenir)</li>
              <li className="text-white/30">✗ PRO bileşenlere erişim yok</li>
              <li className="text-white/30">✗ PRO .riv dosyalarına erişim yok</li>
            </ul>
          </div>
          <div className="p-6 rounded-2xl border border-[#ff2b73]/30 bg-[#ff2b73]/5">
            <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
              <span className="text-[#ff2b73]">●</span> PRO Üyelik
            </h3>
            <ul className="space-y-2 text-white/60 text-sm">
              <li>✓ Tüm bileşenlere sınırsız erişim</li>
              <li>✓ Tüm .riv dosyalarını sınırsız indirme</li>
              <li>✓ Hazır web şablonlarına erişim</li>
              <li>✓ Ticari kullanım lisansı</li>
              <li>✓ Öncelikli destek</li>
            </ul>
          </div>
        </div>

        {/* State Machine Section */}
        <div className="mt-16 bg-white/[0.02] border border-white/10 rounded-3xl p-8 md:p-12">
          <h2 className="text-3xl font-bold mb-6">State Machine Nedir?</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Rive animasyonları sıradan videolardan veya Lottie dosyalarından farklıdır. İçlerinde <strong className="text-white">State Machine</strong> adını verdiğimiz bir mantık katmanı barındırırlar. Bu katman sayesinde animasyonlar:
          </p>
          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="text-[#ff2b73] font-bold mb-1">Trigger</div>
              <p className="text-sm text-white/50">Bir butona tıklanma gibi anlık olayları algılar</p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="text-[#ff2b73] font-bold mb-1">Number</div>
              <p className="text-sm text-white/50">Mouse pozisyonu, kaydırma değeri gibi sayısal girişler</p>
            </div>
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <div className="text-[#ff2b73] font-bold mb-1">Boolean</div>
              <p className="text-sm text-white/50">Karanlık mod açık/kapalı gibi iki durumlu değerler</p>
            </div>
          </div>
          <p className="text-white/60 leading-relaxed">
            Kütüphanemizdeki bileşen kodlarını kullandığınızda, ilgili State Machine etkileşimleri otomatik olarak dahil edilmiştir.
          </p>
        </div>

        {/* Text Runs Section */}
        <div className="mt-16 bg-white/[0.02] border border-white/10 rounded-3xl p-8 md:p-12">
          <h2 className="text-3xl font-bold mb-6">Yazıları Dinamik Olarak Değiştirmek (Text Runs)</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Rive'ın en güçlü özelliklerinden biri, animasyon içindeki metinleri (örneğin buton üzerindeki "Tıkla" yazısını) kod ile anlık olarak değiştirebilmenizdir. Sitemizden indirdiğiniz şablonlardaki yazıları kendi projenize göre özelleştirmek için şu adımları izleyebilirsiniz:
          </p>
          
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                <span className="text-[#ff2b73]">1.</span> Rive Editöründe Metin Adını (Run Name) Belirleme
              </h3>
              <p className="text-white/60 mb-3">
                İndirdiğiniz orijinal <code className="text-[#ff2b73]">.riv</code> dosyasını Rive editöründe (editor.rive.app) açın. Değiştirmek istediğiniz metni seçin ve sağ paneldeki "Text" bölümünden <strong>Run</strong> ismini bulun. Eğer bir isim yoksa, örneğin <code>ButtonText</code> olarak adlandırıp dosyayı tekrar dışa aktarın.
              </p>
            </div>
            
            <div>
              <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                <span className="text-[#ff2b73]">2.</span> React / Next.js İçinde Yazıyı Değiştirme
              </h3>
              <p className="text-white/60 mb-3">React bileşeninizde <code>setTextRunValue</code> fonksiyonunu kullanarak metni değiştirebilirsiniz:</p>
              <CodeBlock lang="tsx" code={`import { useRive } from "@rive-app/react-webgl2";

export default function CustomButton() {
  const { RiveComponent, rive } = useRive({
    src: "/button.riv",
    stateMachines: "State Machine 1",
    autoplay: true,
    onLoad: () => {
      // Dosya yüklendiğinde yazıyı değiştir
      rive?.setTextRunValue("ButtonText", "Satın Al");
    }
  });

  return <div style={{ width: 300, height: 100 }}><RiveComponent /></div>;
}`} />
            </div>

            <div>
              <h3 className="text-xl font-bold mb-3 flex items-center gap-2">
                <span className="text-[#ff2b73]">3.</span> HTML / JS / Wix İçinde Yazıyı Değiştirme
              </h3>
              <p className="text-white/60 mb-3">Rive örneğini oluşturduğunuzda dönen objeyi kullanarak aynı işlemi yapabilirsiniz:</p>
              <CodeBlock lang="javascript" code={`const r = new rive.Rive({
  src: "animasyon.riv",
  canvas: document.getElementById("canvas"),
  stateMachines: "State Machine 1",
  onLoad: () => {
    // Yazıyı dinamik olarak değiştir
    r.setTextRunValue("ButtonText", "Gönder");
  }
});`} />
            </div>
          </div>
          
          <Tip>Hazırlayacağınız eğitim videolarında, Rive editöründeki <strong>Text Run</strong> alanına isim vermeyi ve ardından koddaki <code>setTextRunValue("Isim", "Yeni Deger")</code> kullanımını göstermeniz, kullanıcılarınızın işini çok kolaylaştıracaktır.</Tip>
        </div>

        {/* Giriş yapmadan erişim notu */}
        <div className="mt-8 p-5 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 text-sm text-white/60">
          <strong className="text-yellow-400">Not:</strong> Giriş yapmadan bileşenlerin yalnızca önizlemelerini görebilirsiniz. Kaynak kodlara ve .riv dosyalarına erişebilmek için ücretsiz üyelik oluşturmanız gerekmektedir.
        </div>
      </div>
    </main>
  );
}
