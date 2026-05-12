(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,95634,e=>{"use strict";var i=e.i(12033),s=e.i(72339);let a=[{id:"react",label:"React / Next.js"},{id:"framer",label:"Framer"},{id:"wix",label:"Wix Studio"},{id:"wordpress",label:"WordPress"},{id:"webflow",label:"Webflow"},{id:"html",label:"HTML / Vanilla JS"},{id:"unity",label:"Unity (C#)"},{id:"android",label:"Android (Java/Kotlin)"}];function n({code:e,lang:a}){let[t,r]=(0,s.useState)(!1);return(0,i.jsxs)("div",{className:"relative group bg-black/60 border border-white/10 rounded-xl p-5 font-mono text-sm text-white/80 overflow-x-auto leading-relaxed mb-4",children:[(0,i.jsx)("button",{onClick:()=>{navigator.clipboard.writeText(e),r(!0),setTimeout(()=>r(!1),2e3)},className:"absolute top-3 right-3 text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded-lg transition-colors text-white/60 hover:text-white",children:t?"Kopyalandı ✓":"Kopyala"}),(0,i.jsx)("pre",{children:e})]})}function t({step:e,children:s}){return(0,i.jsxs)("h2",{className:"text-2xl font-bold mb-6 flex items-center gap-3",children:[(0,i.jsx)("span",{className:"flex items-center justify-center w-8 h-8 rounded-full bg-[#ff2b73]/20 text-[#ff2b73] text-sm font-bold",children:e}),s]})}function r({children:e}){return(0,i.jsxs)("div",{className:"flex gap-3 p-4 bg-[#ff2b73]/5 border border-[#ff2b73]/20 rounded-xl text-sm text-white/70 mb-6",children:[(0,i.jsx)("span",{className:"text-[#ff2b73] text-lg mt-[-2px]",children:"💡"}),(0,i.jsx)("div",{children:e})]})}function l({children:e}){return(0,i.jsxs)("div",{className:"flex gap-3 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl text-sm text-white/70 mb-6",children:[(0,i.jsx)("span",{className:"text-yellow-400 text-lg mt-[-2px]",children:"⚠️"}),(0,i.jsx)("div",{children:e})]})}let d={react:function(){return(0,i.jsxs)("div",{className:"space-y-10",children:[(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:1,children:"Rive Kütüphanesini Kurun"}),(0,i.jsx)("p",{className:"text-white/60 mb-4",children:"React veya Next.js projenizde terminal açın ve aşağıdaki komutu çalıştırın:"}),(0,i.jsx)(n,{code:"npm install @rive-app/react-webgl2"}),(0,i.jsxs)(r,{children:["WebGL2 sürümünü kullanmanız gerekir. ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"@rive-app/react-canvas"})," sürümü hover gibi native listener etkileşimlerini desteklemez."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:2,children:".riv Dosyasını Projeye Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["İndirdiğiniz ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:".riv"})," dosyasını projenizin ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"public/"})," klasörüne kopyalayın:"]}),(0,i.jsx)(n,{code:`my-project/
├── public/
│   └── button-hover.riv   ← buraya koyun
├── src/
│   └── components/
│       └── RiveButton.tsx  ← bileşen dosyası
└── package.json`})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:3,children:"Bileşen Kodunu Oluşturun"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Kütüphanemizden kopyaladığınız kodu yeni bir ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:".tsx"})," dosyasına yapıştırın:"]}),(0,i.jsx)(n,{lang:"tsx",code:`import { useRive } from "@rive-app/react-webgl2";

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
}`}),(0,i.jsxs)(l,{children:[(0,i.jsx)("strong",{children:"stateMachines"})," değeri bileşenin sayfasında yazan değerle birebir aynı olmalıdır. Yanlış yazarsanız animasyon oynar ama etkileşimler çalışmaz."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:4,children:"Sayfanızda Kullanın"}),(0,i.jsx)(n,{lang:"tsx",code:`import RiveButton from "@/components/RiveButton";

export default function HomePage() {
  return (
    <main>
      <h1>Hoş Geldiniz</h1>
      <RiveButton />
    </main>
  );
}`}),(0,i.jsxs)(r,{children:["Next.js App Router kullanıyorsanız, Rive bileşenlerinizin en üstüne ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:'"use client";'})," eklemeyi unutmayın."]})]})]})},framer:function(){return(0,i.jsxs)("div",{className:"space-y-10",children:[(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:1,children:"Framer Projenizi Açın"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Framer üzerinde çalıştığınız projenizde yeni bir ",(0,i.jsx)("strong",{children:"Code Component"})," oluşturmanız gerekecek. Framer'ın kod bileşenleri React tabanlı olduğu için entegrasyon oldukça basittir."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:2,children:"Code Component Oluşturun"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Framer arayüzünde ",(0,i.jsxs)("strong",{children:["Assets ",">"," Code ",">"," Component"]})," yolunu izleyip yeni bir bileşen oluşturun (Örneğin: ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"RiveAnimation"}),")."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:3,children:"Bileşen Kodunu Ekleyin"}),(0,i.jsx)("p",{className:"text-white/60 mb-4",children:"Oluşturduğunuz bileşenin içeriğine aşağıdaki React kodunu yapıştırın. Bu kod, Rive kütüphanesini dışarıdan yükleyerek çalıştırır:"}),(0,i.jsx)(n,{lang:"tsx",code:`import React from "react"
import { useRive } from "@rive-app/react-webgl2"

// URL kısmını k\xfct\xfcphanemizden indirdiğiniz veya sunucunuza y\xfcklediğiniz .riv linki ile değiştirin
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
}`}),(0,i.jsxs)(r,{children:["Framer'da yerel bir ",(0,i.jsx)("code",{children:".riv"})," dosyasını doğrudan Asset olarak yüklemek her zaman desteklenmeyebilir. Dosyanızı bir CDN veya sunucuya yükleyip URL olarak vermek en garanti yöntemdir."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:4,children:"Ticari Projelerinizde Kullanın"}),(0,i.jsx)("p",{className:"text-white/60 mb-4",children:"Bileşeni sayfaya sürükleyip bıraktığınızda, hover ve click gibi State Machine trigger'ları doğrudan Framer preview modunda çalışmaya başlayacaktır."})]})]})},wix:function(){return(0,i.jsxs)("div",{className:"space-y-10",children:[(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:1,children:"Wix Studio Özel Öğe (Custom Element) Ekleme"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Wix Studio editöründe ",(0,i.jsxs)("strong",{children:["Ekle (+) ",">"," Göm ve Paylaş ",">"," Özel Öğe (Custom Element)"]})," sürükleyerek sayfanıza ekleyin."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:2,children:".riv Dosyasını Yükleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Wix Medya Yöneticisine ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:".riv"})," dosyanızı yükleyin ve ardından dosyanın genel URL'sini (Public URL) kopyalayın."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:3,children:"Kod Bağlantısını Yapın"}),(0,i.jsx)("p",{className:"text-white/60 mb-4",children:'Özel öğeyi seçip "Kod Seç" alanına tıklayın. "Velo dosyası" veya "Sunucu dosyası" seçeneği ile aşağıdaki kodu içeren bir JavaScript dosyası bağlayın:'}),(0,i.jsx)(n,{lang:"javascript",code:`// Rive CDN \xfczerinden y\xfcklenir
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
customElements.define('rive-animation', RiveElement);`}),(0,i.jsxs)(l,{children:["Wix Studio içerisinde ",(0,i.jsx)("code",{children:"customElements.define"}),' ile etiket ismini belirlerken Özel Öğe ayarlarındaki "Etiket Adı" ile birebir aynı olmasına dikkat edin.']})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:4,children:"Yayınlayın ve Test Edin"}),(0,i.jsx)("p",{className:"text-white/60 mb-4",children:"Wix sitenizi yayınladığınızda animasyonlarınız %100 sorunsuz şekilde etkileşimli olarak (hover, click vb.) çalışacaktır. Üstelik PRO pakette sunduğumuz %100 Ticari Kullanım İzni sayesinde müşteri sitelerinde özgürce satabilirsiniz."})]})]})},wordpress:function(){return(0,i.jsxs)("div",{className:"space-y-10",children:[(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:1,children:".riv Dosyasını Yükleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["WordPress yönetici panelinize girin → ",(0,i.jsx)("strong",{children:"Medya → Yeni Ekle"})," ile ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:".riv"})," dosyasını yükleyin."]}),(0,i.jsxs)(l,{children:["WordPress varsayılan olarak ",(0,i.jsx)("code",{children:".riv"})," uzantısını engelleyebilir. Bu durumda ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"functions.php"})," dosyanıza şu kodu ekleyin:"]}),(0,i.jsx)(n,{lang:"php",code:`// functions.php dosyanıza ekleyin
function allow_riv_upload( $mimes ) {
    $mimes['riv'] = 'application/octet-stream';
    return $mimes;
}
add_filter( 'upload_mimes', 'allow_riv_upload' );`}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Yükleme tamamlandıktan sonra dosyanın URL'sini kopyalayın. Örn: ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"https://siteadresiniz.com/wp-content/uploads/2026/05/button.riv"})]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:2,children:"Rive Runtime Kodunu Sayfaya Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:[(0,i.jsx)("strong",{children:"Görünüm → Tema Dosya Düzenleyicisi → header.php"})," dosyasının ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"</head>"})," etiketinin hemen üstüne ekleyin:"]}),(0,i.jsx)(n,{lang:"html",code:'<script src="https://unpkg.com/@rive-app/canvas@latest"></script>'})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:3,children:"Sayfanıza Canvas Bloğu Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Gutenberg editöründe ",(0,i.jsx)("strong",{children:'"Özel HTML"'})," bloğu ekleyip aşağıdaki kodu yapıştırın:"]}),(0,i.jsx)(n,{lang:"html",code:`<canvas id="rive-button" width="300" height="120"
  style="display:block; margin:0 auto;"></canvas>

<script>
  const r = new rive.Rive({
    src: "https://siteadresiniz.com/wp-content/uploads/2026/05/button.riv",
    canvas: document.getElementById("rive-button"),
    stateMachines: "State Machine 1",
    autoplay: true,
    onLoad: () => r.resizeDrawingSurfaceToCanvas(),
  });
</script>`}),(0,i.jsxs)(r,{children:[(0,i.jsx)("code",{children:"src"})," kısmına 1. adımda kopyaladığınız medya URL'sini yapıştırın. ",(0,i.jsx)("code",{children:"stateMachines"})," değerini bileşen sayfasından alın."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:4,children:"Elementor / WPBakery Kullanıyorsanız"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Elementor'da ",(0,i.jsx)("strong",{children:'"HTML"'})," widget'ı, WPBakery'de ",(0,i.jsx)("strong",{children:'"Raw HTML"'})," elementi kullanarak 3. adımdaki aynı kodu yapıştırabilirsiniz. Kod birebir aynı şekilde çalışacaktır."]})]})]})},webflow:function(){return(0,i.jsxs)("div",{className:"space-y-10",children:[(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:1,children:".riv Dosyasını Webflow'a Yükleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:[(0,i.jsx)("strong",{children:"Assets Panel → Upload"})," ile ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:".riv"})," dosyasını yükleyin ve dosya URL'sini kopyalayın."]}),(0,i.jsxs)(r,{children:["Webflow ",(0,i.jsx)("code",{children:".riv"})," formatını tanımazsa, dosyayı bir CDN'e (örn: Cloudflare R2, AWS S3) yükleyip oradan URL alabilirsiniz."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:2,children:"Rive Runtime'ı Projeye Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:[(0,i.jsx)("strong",{children:"Project Settings → Custom Code → Head Code"})," alanına ekleyin:"]}),(0,i.jsx)(n,{lang:"html",code:'<script src="https://unpkg.com/@rive-app/canvas@latest"></script>'})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:3,children:"Canvas Embed Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Sayfanızda ",(0,i.jsx)("strong",{children:"Embed"})," elementi ekleyin ve içine:"]}),(0,i.jsx)(n,{lang:"html",code:`<canvas id="rive-anim" width="400" height="400"
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
</script>`})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:4,children:"Responsive Ayarları"}),(0,i.jsx)("p",{className:"text-white/60 mb-4",children:"Canvas'ın responsive olması için stil ayarlarını şu şekilde yapın:"}),(0,i.jsx)(n,{lang:"css",code:`#rive-anim {
  width: 100%;
  max-width: 400px;
  height: auto;
  aspect-ratio: 1 / 1;
}`})]})]})},html:function(){return(0,i.jsxs)("div",{className:"space-y-10",children:[(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:1,children:"Rive JS Runtime'ı Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["HTML dosyanızın ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"<head>"})," bölümüne:"]}),(0,i.jsx)(n,{lang:"html",code:'<script src="https://unpkg.com/@rive-app/canvas@latest"></script>'})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:2,children:"Canvas Elementi Oluşturun"}),(0,i.jsx)(n,{lang:"html",code:'<canvas id="my-rive" width="500" height="500"></canvas>'})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:3,children:"Rive'ı Başlatın"}),(0,i.jsx)(n,{lang:"html",code:`<script>
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
</script>`}),(0,i.jsxs)(r,{children:["Birden fazla animasyon kullanacaksanız her biri için ayrı ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"canvas"})," ve ayrı ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"Rive"})," instance'ı oluşturun."]})]})]})},unity:function(){return(0,i.jsxs)("div",{className:"space-y-10",children:[(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:1,children:"Rive Unity Package'ı Kurun"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Unity editöründe ",(0,i.jsx)("strong",{children:"Window → Package Manager → Add package from git URL"})," seçeneğine tıklayın:"]}),(0,i.jsx)(n,{code:"https://github.com/rive-app/rive-unity.git"}),(0,i.jsxs)(l,{children:["Unity ",(0,i.jsx)("strong",{children:"2022.3 LTS"})," veya üstü gereklidir. Eski sürümlerde derleme hataları alabilirsiniz."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:2,children:".riv Dosyasını İçe Aktarın"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["İndirdiğiniz ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:".riv"})," dosyasını ",(0,i.jsx)("strong",{children:"Assets"})," klasörüne sürükleyin. Unity dosyayı otomatik olarak bir ",(0,i.jsx)("strong",{children:"Rive Asset"})," olarak tanıyacaktır."]})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:3,children:"Sahneye Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Bir UI Canvas veya RawImage objesine ",(0,i.jsx)("strong",{children:"RiveScreen"})," component'ini ekleyin:"]}),(0,i.jsx)(n,{lang:"csharp",code:`using Rive;
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
            Debug.Log("State Machine y\xfcklendi: " + sm.Name);
        }
    }
}`})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:4,children:"Etkileşim Ekleyin"}),(0,i.jsx)("p",{className:"text-white/60 mb-4",children:"Mouse tıklamasıyla trigger tetiklemek için:"}),(0,i.jsx)(n,{lang:"csharp",code:`void Update()
{
    if (Input.GetMouseButtonDown(0))
    {
        var trigger = riveScreen.StateMachine?
            .GetTrigger("clicked");
        trigger?.Fire();
    }
}`}),(0,i.jsx)(r,{children:"Trigger, Boolean ve Number input isimlerini bileşen sayfasındaki State Machine bilgilerinden öğrenebilirsiniz."})]})]})},android:function(){return(0,i.jsxs)("div",{className:"space-y-10",children:[(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:1,children:"Gradle Bağımlılığını Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Modül seviyesindeki ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"build.gradle"})," dosyanıza:"]}),(0,i.jsx)(n,{lang:"groovy",code:`dependencies {
    implementation "app.rive:rive-android:9.+"
    // Kotlin kullanıyorsanız:
    // implementation "app.rive:rive-android-kotlin:9.+"
}`})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:2,children:".riv Dosyasını Ekleyin"}),(0,i.jsxs)("p",{className:"text-white/60 mb-4",children:["Dosyayı ",(0,i.jsx)("code",{className:"text-[#ff2b73]",children:"res/raw/"})," klasörüne koyun:"]}),(0,i.jsx)(n,{code:`app/
└── src/main/
    └── res/
        └── raw/
            └── button_hover.riv`})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:3,children:"Layout XML'e Ekleyin"}),(0,i.jsx)(n,{lang:"xml",code:`<app.rive.runtime.core.RiveAnimationView
    android:id="@+id/rive_view"
    android:layout_width="300dp"
    android:layout_height="120dp"
    app:rivResource="@raw/button_hover"
    app:riveStateMachine="State Machine 1"
    app:riveAutoPlay="true" />`})]}),(0,i.jsxs)("section",{children:[(0,i.jsx)(t,{step:4,children:"Java ile Etkileşim"}),(0,i.jsx)(n,{lang:"java",code:`RiveAnimationView riveView = findViewById(R.id.rive_view);

// Trigger tetikleme
riveView.fireState("State Machine 1", "clicked");

// Boolean değer ayarlama
riveView.setBooleanState(
    "State Machine 1", "isHovered", true
);

// Number değer ayarlama
riveView.setNumberState(
    "State Machine 1", "progress", 0.75f
);`}),(0,i.jsx)(r,{children:"Kotlin kullanıyorsanız aynı API'ler geçerlidir, yalnızca syntax farkı vardır."})]})]})}};e.s(["default",0,function(){let[e,n]=(0,s.useState)("react"),t=d[e];return(0,i.jsx)("main",{className:"min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6",children:(0,i.jsxs)("div",{className:"max-w-5xl mx-auto",children:[(0,i.jsxs)("div",{className:"mb-12 text-center md:text-left",children:[(0,i.jsx)("h1",{className:"text-4xl md:text-5xl font-bold tracking-tight mb-6",children:"Rive Dosyası Nasıl Çalıştırılır? & Entegrasyon Kılavuzu"}),(0,i.jsxs)("p",{className:"text-xl text-white/70 leading-relaxed max-w-3xl mb-6",children:["VK UI platformundan indirdiğiniz ",(0,i.jsx)("strong",{children:"hazır web animasyonları"})," ve ",(0,i.jsx)("strong",{children:"ücretsiz / ücretli Rive (.riv) şablonlarını"})," projelerinize nasıl dahil edeceğinizi öğrenin. React, Next.js, Framer, Wix Studio, Webflow ve WordPress gibi tüm modern arayüzleri destekliyoruz."]}),(0,i.jsxs)("div",{className:"flex flex-wrap gap-3 mb-6 items-center md:justify-start justify-center",children:[(0,i.jsx)("span",{className:"px-3 py-1 bg-green-500/10 text-green-400 border border-green-500/20 rounded-full text-sm font-semibold",children:"Tüm Şablonlar %100 Ticari Kullanıma Uygundur"}),(0,i.jsx)("span",{className:"px-3 py-1 bg-[#ff2b73]/10 text-[#ff2b73] border border-[#ff2b73]/20 rounded-full text-sm font-semibold",children:"Aylık Sınırsız İndirme (PRO)"}),(0,i.jsx)("span",{className:"px-3 py-1 bg-white/5 border border-white/10 rounded-full text-sm font-semibold text-white/70",children:"Ücretsiz Rive Şablonları"})]}),(0,i.jsx)("p",{className:"text-base text-white/50 leading-relaxed max-w-4xl",children:"İster yapay zeka destekli bir uygulama, ister kurumsal bir SaaS, isterseniz de bir e-ticaret arayüzü geliştiriyor olun. Rive dosyalarını entegre etmek saniyeler sürer. Müşteri projelerinizde (Ticari amaçla) güvenle kullanabilir, web sitelerinizin kullanıcı deneyimini (UI/UX) muazzam seviyede artırabilirsiniz."})]}),(0,i.jsx)("div",{className:"flex flex-wrap gap-2 mb-12 p-1.5 bg-white/5 border border-white/10 rounded-2xl",children:a.map(s=>(0,i.jsx)("button",{onClick:()=>n(s.id),className:`px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${e===s.id?"bg-[#ff2b73] text-white shadow-lg shadow-[#ff2b73]/20":"text-white/50 hover:text-white hover:bg-white/5"}`,children:s.label},s.id))}),(0,i.jsx)("div",{className:"bg-white/[0.02] border border-white/10 rounded-3xl p-8 md:p-12",children:(0,i.jsx)(t,{})}),(0,i.jsxs)("div",{className:"mt-16 grid md:grid-cols-2 gap-6",children:[(0,i.jsxs)("div",{className:"p-6 rounded-2xl border border-white/10 bg-white/5",children:[(0,i.jsxs)("h3",{className:"font-bold text-lg mb-3 flex items-center gap-2",children:[(0,i.jsx)("span",{className:"text-green-400",children:"●"})," Ücretsiz Üyelik"]}),(0,i.jsxs)("ul",{className:"space-y-2 text-white/60 text-sm",children:[(0,i.jsx)("li",{children:"✓ Ücretsiz bileşenlerin .riv dosyalarını indirme"}),(0,i.jsx)("li",{children:"✓ Ücretsiz bileşenlerin React kaynak kodları"}),(0,i.jsx)("li",{children:"✓ Aylık 5 indirme hakkı (her ay yenilenir)"}),(0,i.jsx)("li",{className:"text-white/30",children:"✗ PRO bileşenlere erişim yok"}),(0,i.jsx)("li",{className:"text-white/30",children:"✗ PRO .riv dosyalarına erişim yok"})]})]}),(0,i.jsxs)("div",{className:"p-6 rounded-2xl border border-[#ff2b73]/30 bg-[#ff2b73]/5",children:[(0,i.jsxs)("h3",{className:"font-bold text-lg mb-3 flex items-center gap-2",children:[(0,i.jsx)("span",{className:"text-[#ff2b73]",children:"●"})," PRO Üyelik"]}),(0,i.jsxs)("ul",{className:"space-y-2 text-white/60 text-sm",children:[(0,i.jsx)("li",{children:"✓ Tüm bileşenlere sınırsız erişim"}),(0,i.jsx)("li",{children:"✓ Tüm .riv dosyalarını sınırsız indirme"}),(0,i.jsx)("li",{children:"✓ Hazır web şablonlarına erişim"}),(0,i.jsx)("li",{children:"✓ Ticari kullanım lisansı"}),(0,i.jsx)("li",{children:"✓ Öncelikli destek"})]})]})]}),(0,i.jsxs)("div",{className:"mt-16 bg-white/[0.02] border border-white/10 rounded-3xl p-8 md:p-12",children:[(0,i.jsx)("h2",{className:"text-3xl font-bold mb-6",children:"State Machine Nedir?"}),(0,i.jsxs)("p",{className:"text-white/60 leading-relaxed mb-6",children:["Rive animasyonları sıradan videolardan veya Lottie dosyalarından farklıdır. İçlerinde ",(0,i.jsx)("strong",{className:"text-white",children:"State Machine"})," adını verdiğimiz bir mantık katmanı barındırırlar. Bu katman sayesinde animasyonlar:"]}),(0,i.jsxs)("div",{className:"grid sm:grid-cols-3 gap-4 mb-6",children:[(0,i.jsxs)("div",{className:"p-4 rounded-xl bg-white/5 border border-white/10",children:[(0,i.jsx)("div",{className:"text-[#ff2b73] font-bold mb-1",children:"Trigger"}),(0,i.jsx)("p",{className:"text-sm text-white/50",children:"Bir butona tıklanma gibi anlık olayları algılar"})]}),(0,i.jsxs)("div",{className:"p-4 rounded-xl bg-white/5 border border-white/10",children:[(0,i.jsx)("div",{className:"text-[#ff2b73] font-bold mb-1",children:"Number"}),(0,i.jsx)("p",{className:"text-sm text-white/50",children:"Mouse pozisyonu, kaydırma değeri gibi sayısal girişler"})]}),(0,i.jsxs)("div",{className:"p-4 rounded-xl bg-white/5 border border-white/10",children:[(0,i.jsx)("div",{className:"text-[#ff2b73] font-bold mb-1",children:"Boolean"}),(0,i.jsx)("p",{className:"text-sm text-white/50",children:"Karanlık mod açık/kapalı gibi iki durumlu değerler"})]})]}),(0,i.jsx)("p",{className:"text-white/60 leading-relaxed",children:"Kütüphanemizdeki bileşen kodlarını kullandığınızda, ilgili State Machine etkileşimleri otomatik olarak dahil edilmiştir."})]}),(0,i.jsxs)("div",{className:"mt-8 p-5 rounded-2xl border border-yellow-500/20 bg-yellow-500/5 text-sm text-white/60",children:[(0,i.jsx)("strong",{className:"text-yellow-400",children:"Not:"})," Giriş yapmadan bileşenlerin yalnızca önizlemelerini görebilirsiniz. Kaynak kodlara ve .riv dosyalarına erişebilmek için ücretsiz üyelik oluşturmanız gerekmektedir."]})]})})}])}]);