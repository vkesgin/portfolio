"use client";

import { useState, useEffect, useMemo } from "react";
import RiveDemo from "./RiveDemo";

interface UIComponent {
  id: string;
  title: string;
  category: string;
  description: string;
  image_url: string;
  is_featured: boolean;
  tags?: string;
}

interface RiveCfg {
  artboard?: string;
  stateMachines?: string[];
  statemachine?: string;
  inputs?: { name: string; type: number }[];
}

// ─── Multi-Framework Kod Üretici ──────────────────────────────────────────────
function generateCode(
  framework: "react" | "js" | "rn" | "flutter",
  cfg: RiveCfg,
  fileName: string,
  title: string,
  customText?: string
) {
  const ab = cfg.artboard || "";
  const sm = (cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []))[0] ?? "";
  const inputs = cfg.inputs ?? [];
  const triggers = inputs.filter((i) => i.type === 0);
  const isNative = sm && inputs.length === 0;
  const fnName = title.replace(/[^a-zA-Z0-9]/g, "") || "RiveComponent";
  const rivFile = fileName || "animation.riv";

  if (framework === "react") {
    let c = `"use client";\n\nimport { useEffect, useMemo } from "react";\nimport { useRive } from "@rive-app/react-canvas";\n\nexport default function ${fnName}() {\n  const RIVE_FILE = "/rive/${rivFile}";\n`;
    if (ab) c += `  const ARTBOARD = "${ab}";\n`;
    if (sm) c += `  const STATE_MACHINE = "${sm}";\n`;
    c += `\n  const { rive, RiveComponent } = useRive({\n    src: RIVE_FILE,\n`;
    if (ab) c += `    artboard: ARTBOARD,\n`;
    if (sm) c += `    stateMachines: STATE_MACHINE,\n`;
    
    if (customText) {
      c += `    onLoad: () => {\n`;
      c += `      try {\n`;
      c += `        rive?.setTextRunValue("ButtonText", "${customText}");\n`;
      c += `      } catch (e) {}\n`;
      c += `    },\n`;
    }
    
    c += `    autoplay: true,\n    shouldResizeCanvasToContainer: true,\n  });\n`;
    
    if (customText) {
      c += `\n  useEffect(() => {\n`;
      c += `    if (rive) {\n`;
      c += `      try { rive.setTextRunValue("ButtonText", "${customText}"); } catch (e) {}\n`;
      c += `    }\n`;
      c += `  }, [rive]);\n`;
    }

    if (sm && triggers.length > 0) {
      c += `\n  const smInputs = useMemo(\n    () => rive?.stateMachineInputs(STATE_MACHINE) ?? [],\n    [rive],\n  );\n`;
      triggers.forEach((t) => {
        const v = t.name.replace(/\W/g, "_").toLowerCase() + "Input";
        c += `\n  const ${v} = smInputs.find((i) => i.name === "${t.name}");\n`;
        const fn = "fire" + t.name[0].toUpperCase() + t.name.slice(1);
        c += `  const ${fn} = () => { if (${v}) ${v}.fire(); };\n`;
      });
    } else if (isNative) {
      c += `\n  // Bu animasyon Rive Editor'de tanımlanmış built-in pointer listener'ları kullanıyor.\n  // Hover/click olayları canvas'a native olarak iletilir — ek React kodu gerekmez.\n`;
    }

    c += `\n  return (\n    <div className="w-full h-[420px]">\n      <RiveComponent className="w-full h-full" style={{ display: "block" }} />\n    </div>\n`;
    if (triggers.length) {
      c += `    <div className="flex gap-3 mt-4">\n`;
      triggers.forEach((t) => {
        const fn = "fire" + t.name[0].toUpperCase() + t.name.slice(1);
        c += `      <button onClick={${fn}}>Fire "${t.name}"</button>\n`;
      });
      c += `    </div>\n`;
    }
    c += `  );\n}\n`;
    return c;
  }

  if (framework === "js") {
    let c = `import { Rive, Layout, Fit, Alignment } from "@rive-app/canvas";\n\n`;
    c += `const canvas = document.getElementById("rive-canvas");\n\n`;
    c += `const r = new Rive({\n  src: "/rive/${rivFile}",\n  canvas,\n`;
    if (ab) c += `  artboard: "${ab}",\n`;
    if (sm) c += `  stateMachines: "${sm}",\n`;
    c += `  autoplay: true,\n  layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),\n`;
    c += `  onLoad: () => {\n    r.resizeDrawingSurfaceToCanvas();\n`;
    
    if (customText) {
      c += `    try { r.setTextRunValue("ButtonText", "${customText}"); } catch (e) {}\n`;
    }
    
    if (triggers.length) {
      c += `    const inputs = r.stateMachineInputs("${sm}");\n`;
      triggers.forEach((t) => {
        c += `    // const ${t.name.replace(/\W/g, "_")}Input = inputs.find(i => i.name === "${t.name}");\n`;
        c += `    // ${t.name.replace(/\W/g, "_")}Input?.fire();\n`;
      });
    } else if (isNative) {
      c += `    // Native hover/click — canvas pointer events Rive tarafından otomatik işlenir\n`;
    }
    c += `  }\n});\n\n/* HTML:\n<canvas id="rive-canvas" width="400" height="300"></canvas>\n*/\n`;
    return c;
  }

  if (framework === "rn") {
    let c = `import Rive, { Fit } from "@rive-app/react-native";\n\nexport default function ${fnName}() {\n  return (\n    <Rive\n`;
    c += `      resourceName="${rivFile.replace(".riv", "")}"\n`;
    if (ab) c += `      artboardName="${ab}"\n`;
    if (sm) c += `      stateMachineName="${sm}"\n`;
    c += `      fit={Fit.Contain}\n      autoplay\n    />\n  );\n}\n\n/* Kurulum:\nnpm install @rive-app/react-native react-native-nitro-modules\n.riv dosyasını assets/ klasörüne koy */\n`;
    return c;
  }

  if (framework === "flutter") {
    let c = `import 'package:flutter/material.dart';\nimport 'package:rive/rive.dart';\n\nclass ${fnName} extends StatelessWidget {\n  const ${fnName}({super.key});\n\n  @override\n  Widget build(BuildContext context) {\n    return SizedBox(\n      width: 400, height: 300,\n      child: RiveAnimation.asset(\n        'assets/${rivFile}',\n`;
    if (ab) c += `        artboard: '${ab}',\n`;
    if (sm) c += `        stateMachines: ['${sm}'],\n`;
    c += `        fit: BoxFit.contain,\n      ),\n    );\n  }\n}\n\n/* pubspec.yaml:\ndependencies:\n  rive: ^0.12.0\nflutter:\n  assets:\n    - assets/${rivFile}\n*/\n`;
    return c;
  }

  return "";
}

const FRAMEWORKS = [
  { id: "react" as const, label: "React", icon: "⚛", note: "Next.js / Vite" },
  { id: "js" as const, label: "JavaScript", icon: "🌐", note: "Vanilla / HTML" },
  { id: "rn" as const, label: "React Native", icon: "📱", note: "iOS & Android" },
  { id: "flutter" as const, label: "Flutter", icon: "🐦", note: "Dart / Multi" },
];

// ─── Ana Bileşen ───────────────────────────────────────────────────────────────
export default function ComponentGrid() {
  const [components, setComponents] = useState<UIComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedComp, setSelectedComp] = useState<UIComponent | null>(null);
  const [activeFramework, setActiveFramework] = useState<"react" | "js" | "rn" | "flutter">("react");
  const [copied, setCopied] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "free" | "pro" | "buttons">("all");

  const [user, setUser] = useState<any>(null);
  const [remainingDownloads, setRemainingDownloads] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [customText, setCustomText] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [fullscreenPreview, setFullscreenPreview] = useState(false);
  const [defaultLabel, setDefaultLabel] = useState("");

  useEffect(() => {
    async function fetchComponents() {
      try {
        const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/projects?category=uilib");
        if (res.ok) setComponents(await res.json());
      } catch (err) {
        console.error("Veri çekilemedi:", err);
      } finally {
        setLoading(false);
      }
    }
    
    async function fetchUser() {
      const token = localStorage.getItem("ui_token");
      if (token) {
        try {
          const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/me", {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            setUser(data.user);
            if (data.user.remaining_downloads !== undefined) {
              setRemainingDownloads(data.user.remaining_downloads);
            }
          }
        } catch (err) {}
      }
    }

    fetchComponents();
    fetchUser();
  }, []);

  const isPro = user?.plan === "PRO";
  const lsCheckoutUrl = user ? `https://velikesgin.lemonsqueezy.com/checkout/buy/4862289b-3640-4a46-aaee-151a0c52caad?checkout[custom][user_id]=${user.id}` : "/ui/login";

  // İndirme hakkı kontrolü yaparak kodu kopyala veya .riv indir
  const trackDownload = async (componentId: string, type: "code" | "riv"): Promise<boolean> => {
    const token = localStorage.getItem("ui_token");
    if (!token) return false;
    setDownloadError(null);
    setDownloading(true);
    try {
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/download", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ component_id: componentId, download_type: type }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDownloadError(data.error || "İndirme başarısız");
        return false;
      }
      if (data.remaining_downloads !== undefined) {
        setRemainingDownloads(data.remaining_downloads);
      }
      return true;
    } catch {
      setDownloadError("Sunucu hatası");
      return false;
    } finally {
      setDownloading(false);
    }
  };

  const handleCopy = async (code: string, componentId?: string) => {
    if (componentId) {
      const ok = await trackDownload(componentId, "code");
      if (!ok) return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const selectedCfg = useMemo<RiveCfg>(() => {
    try { return selectedComp?.tags ? JSON.parse(selectedComp.tags) : {}; } catch { return {}; }
  }, [selectedComp]);

  const selectedFileName = useMemo(
    () => selectedComp?.image_url?.split("/").pop() ?? "animation.riv",
    [selectedComp]
  );

  const generatedCode = useMemo(() => {
    if (!selectedComp) return "";
    return generateCode(activeFramework, selectedCfg, selectedFileName, selectedComp.title, customText);
  }, [selectedComp, activeFramework, selectedCfg, selectedFileName, customText]);

  const filteredComponents = useMemo(() => {
    return components.filter(comp => {
      if (activeFilter === "free" && comp.is_featured) return false;
      if (activeFilter === "pro" && !comp.is_featured) return false;
      if (activeFilter === "buttons") {
        const text = (comp.title + " " + comp.description).toLowerCase();
        if (!text.includes("buton") && !text.includes("button")) return false;
      }
      return true;
    });
  }, [components, activeFilter]);

  if (loading) return (
    <div className="py-20 text-center">
      <div className="w-8 h-8 mx-auto mb-4 border-4 border-[#ff2b73] border-t-transparent rounded-full animate-spin" />
      <p className="text-white/40">Bileşenler yükleniyor...</p>
    </div>
  );

  if (components.length === 0) return (
    <div className="py-20 text-center border border-white/5 rounded-3xl bg-white/[0.02]">
      <p className="text-white/40">Henüz bileşen eklenmedi.</p>
      <p className="text-white/20 text-sm mt-2">Admin panelinden ilk bileşenini ekleyebilirsin.</p>
    </div>
  );

  return (
    <>
      {/* FILTER BAR */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div className="flex flex-wrap items-center gap-2 p-1 rounded-2xl bg-white/5 border border-white/10 w-full md:w-auto overflow-x-auto">
          {[
            { id: "all", label: "Tümü" },
            { id: "free", label: "Ücretsiz" },
            { id: "pro", label: "PRO" },
            { id: "buttons", label: "Butonlar" },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setActiveFilter(f.id as any)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${
                activeFilter === f.id
                  ? "bg-[#ff2b73] text-white shadow-lg shadow-[#ff2b73]/20"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="text-sm text-white/40">{filteredComponents.length} bileşen gösteriliyor</div>
      </div>

      {/* GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredComponents.map((comp) => {
          let cfg: RiveCfg = {};
          try { if (comp.tags) cfg = JSON.parse(comp.tags); } catch (_) {}
          const sms = cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []);

          return (
            <div key={comp.id} className="flex flex-col bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden hover:border-white/10 transition-colors">

              {/* PREVIEW — sabit yükseklik, transform YOK */}
              <div className="relative w-full bg-black/40" style={{ height: "240px" }}>
                {/* Badges */}
                <div className="absolute top-3 right-3 z-10 flex gap-2 pointer-events-none">
                  {comp.is_featured ? (
                    <span className="px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white">PRO</span>
                  ) : (
                    <span className="px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-white/10 text-white">FREE</span>
                  )}
                </div>

                {comp.image_url ? (
                  /*
                   * CRITICAL: Explicit pixel height, no h-full chain.
                   * ResizeObserver in RiveDemo reads this container's real px size.
                   * padding = breathing room around the animation.
                   */
                  <div style={{ position: "absolute", inset: "20px", display: "flex" }}>
                    <RiveDemo
                      src={`https://vk-portfolio-api.vkesgin38.workers.dev${comp.image_url}`}
                      artboard={cfg.artboard}
                      stateMachines={sms}
                    />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-white/20 text-sm">Görsel Yok</div>
                )}
              </div>

              {/* INFO */}
              <div className="p-6 border-t border-white/5 flex-1 flex flex-col">
                <h3 className="text-lg font-semibold mb-1 hover:text-[#ff2b73] transition-colors">{comp.title}</h3>
                {/* Animasyon tipi göstergesi */}
                {sms.length > 0 && (
                  <p className="text-[11px] font-mono mb-3">
                    {(cfg.inputs?.length === 0) ? (
                      <span className="text-cyan-400">✦ hover / native pointer</span>
                    ) : (cfg.inputs ?? []).some(i => i.type === 0) ? (
                      <span className="text-[#ff2b73]">✦ tıkla → ateşle</span>
                    ) : (
                      <span className="text-white/30">✦ animasyon</span>
                    )}
                  </p>
                )}
                <div className="mt-auto pt-4">
                  <button
                    onClick={() => { setSelectedComp(comp); setActiveFramework("react"); }}
                    className="w-full py-3 text-sm font-medium rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Kodu Göster
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* CODE MODAL */}
      {selectedComp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => { setSelectedComp(null); setCustomText(""); setPreviewText(""); }} />
          <div className="relative w-full max-w-5xl bg-[#080808] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02] shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold">{selectedComp.title}</h3>
                {selectedComp.is_featured && (
                  <span className="px-2 py-0.5 text-[10px] bg-[#ff2b73]/20 text-[#ff2b73] rounded-full border border-[#ff2b73]/30">PRO</span>
                )}
              </div>
              <button onClick={() => { setSelectedComp(null); setCustomText(""); setPreviewText(""); }} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-auto">
              {!user ? (
                /* ═══════════════════════════════════════════════════════
                   GİRİŞ YAPMAMIŞ KULLANICI — Sadece önizleme, download/kod YOK
                   ═══════════════════════════════════════════════════════ */
                <div className="flex flex-col lg:flex-row" style={{ minHeight: "400px" }}>
                  {/* Preview — erişilebilir */}
                  <div className="lg:w-2/5 p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20">
                    <div className="relative w-full max-w-xs rounded-2xl overflow-hidden border border-white/10 bg-black/40" style={{ height: "240px" }}>
                      <div className="absolute" style={{ inset: "20px", display: "flex" }}>
                        <RiveDemo
                          src={`https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`}
                          artboard={selectedCfg.artboard}
                          stateMachines={selectedCfg.stateMachines ?? (selectedCfg.statemachine ? [selectedCfg.statemachine] : [])}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Paywall — kod/download yok */}
                  <div className="lg:w-3/5 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-16 h-16 mb-5 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
                    </div>
                    <h4 className="text-2xl font-bold mb-3">Giriş Yapmanız Gerekiyor</h4>
                    <p className="text-white/50 mb-2 max-w-sm">Bu animasyonun kaynak koduna ve <code className="text-[#ff2b73]">.riv</code> dosyasına erişmek için ücretsiz üye olmalısınız.</p>
                    <p className="text-white/30 text-sm mb-8">Önizlemeyi ücretsiz görebilirsiniz.</p>
                    <div className="flex gap-4">
                      <a href="/ui/login" className="px-6 py-3 rounded-xl bg-white text-black font-semibold hover:bg-gray-200 transition-colors">
                        Giriş Yap
                      </a>
                      <a href="/ui/register" className="px-6 py-3 rounded-xl bg-white/10 font-semibold hover:bg-white/20 transition-colors border border-white/10">
                        Kayıt Ol
                      </a>
                    </div>
                  </div>
                </div>
              ) : selectedComp.is_featured && !isPro ? (
                /* ═══════════════════════════════════════════════════════
                   PRO PAYWALL — Sadece önizleme, download/kod YOK
                   .riv URL'sine de erişim engellendi (download butonu yok)
                   ═══════════════════════════════════════════════════════ */
                <div className="flex flex-col lg:flex-row" style={{ minHeight: "400px" }}>
                  {/* Preview — erişilebilir */}
                  <div className="lg:w-2/5 p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20">
                    <div className="relative w-full max-w-xs rounded-2xl overflow-hidden border border-white/10 bg-black/40" style={{ height: "240px" }}>
                      <div className="absolute" style={{ inset: "20px", display: "flex" }}>
                        <RiveDemo
                          src={`https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`}
                          artboard={selectedCfg.artboard}
                          stateMachines={selectedCfg.stateMachines ?? (selectedCfg.statemachine ? [selectedCfg.statemachine] : [])}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Paywall — kod/download yok */}
                  <div className="lg:w-3/5 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-16 h-16 mb-5 rounded-2xl bg-gradient-to-tr from-[#ff2b73] to-[#ff7e5f] flex items-center justify-center shadow-[0_0_40px_rgba(255,43,115,0.4)]">
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    </div>
                    <h4 className="text-2xl font-bold mb-3">PRO Üyelik Gerekli</h4>
                    <p className="text-white/50 mb-2 max-w-sm">Bu animasyonun kaynak kodu ve <code className="text-[#ff2b73]">.riv</code> dosyası PRO üyelere özeldir.</p>
                    <p className="text-white/30 text-sm mb-8">Önizlemeyi ücretsiz görebilirsiniz.</p>
                    <a href="/ui/pricing" className="px-8 py-3 rounded-xl bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white font-semibold hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,43,115,0.3)]">
                      PRO'ya Yükselt &amp; Kilidi Aç →
                    </a>
                  </div>
                </div>
              ) : (
                /* ═══════════════════
                   FREE — Tam erişim
                   ═══════════════════ */
                <div className="flex flex-col lg:flex-row" style={{ minHeight: "500px" }}>
                  {/* Sol: Preview */}
                  <div className="lg:w-1/2 p-6 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20 gap-4">
                    <div className="relative w-full max-w-md rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-[0_0_40px_rgba(255,43,115,0.05)]" style={{ height: "300px" }}>
                      <div className="absolute" style={{ inset: "20px", display: "flex" }}>
                        <RiveDemo
                          src={`https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`}
                          artboard={selectedCfg.artboard}
                          stateMachines={selectedCfg.stateMachines ?? (selectedCfg.statemachine ? [selectedCfg.statemachine] : [])}
                          label={previewText || undefined}
                          onDefaultLabel={setDefaultLabel}
                        />
                      </div>
                      
                      {/* Tam Ekran İnceleme Butonu */}
                      <button 
                        onClick={() => setFullscreenPreview(true)}
                        className="absolute bottom-3 right-3 p-2 bg-black/60 hover:bg-[#ff2b73] text-white rounded-xl backdrop-blur-md transition-all border border-white/10 group"
                        title="Büyük Ekranda İncele"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
                          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                        </svg>
                      </button>
                    </div>
                    
                    {/* Dinamik Metin Değiştirici */}
                    <div className="w-full max-w-md bg-white/[0.02] border border-white/10 rounded-xl p-4 mt-2">
                      <label className="block text-xs font-semibold text-white/50 mb-2">Buton Yazısını Özelleştir</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          value={customText}
                          onChange={(e) => setCustomText(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && setPreviewText(customText)}
                          placeholder="Örn: Satın Al" 
                          className="flex-1 bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#ff2b73]/50 transition-colors"
                        />
                        <button 
                          onClick={() => setPreviewText(customText)}
                          className="px-4 py-2 bg-white/10 hover:bg-[#ff2b73] text-white text-sm font-medium rounded-lg transition-colors border border-white/10"
                        >
                          Önizle
                        </button>
                        {previewText && (
                          <button 
                            onClick={() => { setPreviewText(""); setCustomText(""); }}
                            className="px-3 py-2 bg-white/5 hover:bg-red-500/30 text-white/50 text-sm rounded-lg transition-colors border border-white/10"
                            title="Sıfırla"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-white/30 mt-2">Yazdığınız metin, kopyaladığınız koda <code className="text-[#ff2b73]">setTextRunValue()</code> olarak eklenir.</p>
                    </div>
                    {/* Tip badge */}
                    {selectedCfg.inputs?.length === 0 && (selectedCfg.stateMachines?.length ?? 0) > 0 && (
                      <span className="text-[11px] text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-3 py-1.5 rounded-full">✦ üzerine gel — hover aktif</span>
                    )}
                    {(selectedCfg.inputs ?? []).some(i => i.type === 0) && (
                      <span className="text-[11px] text-[#ff2b73] bg-[#ff2b73]/10 border border-[#ff2b73]/20 px-3 py-1.5 rounded-full">✦ tıkla — ateşle</span>
                    )}
                    {/* .riv indir */}
                    {remainingDownloads !== null && remainingDownloads === 0 && !isPro ? (
                      <div className="w-full py-3 text-xs text-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
                        Aylık indirme limitiniz doldu (0/5)
                        <a href="/ui/pricing" className="block mt-1 text-[#ff2b73] hover:underline">PRO'ya geç →</a>
                      </div>
                    ) : (
                      <button
                        disabled={downloading}
                        onClick={async () => {
                          const ok = await trackDownload(selectedComp.id, "riv");
                          if (!ok) return;
                          
                          const rivUrl = `https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`;
                          const fileName = selectedComp.image_url.split('/').pop() || 'component.riv';
                          
                          if (previewText && defaultLabel) {
                            // Özel metin + bilinen orijinal label: .riv binary patch
                            try {
                              setDownloading(true);
                              const resp = await fetch(rivUrl);
                              const buf = await resp.arrayBuffer();
                              const original = new Uint8Array(buf);

                              const encoder = new TextEncoder();
                              const oldBytes = encoder.encode(defaultLabel);
                              const newBytes = encoder.encode(previewText);

                              // Tüm eşleşmeleri bul ve değiştir
                              const positions: number[] = [];
                              for (let i = 0; i <= original.length - oldBytes.length; i++) {
                                let match = true;
                                for (let j = 0; j < oldBytes.length; j++) {
                                  if (original[i + j] !== oldBytes[j]) { match = false; break; }
                                }
                                if (match) positions.push(i);
                              }

                              if (positions.length > 0) {
                                // Her eşleşme için byte farkını hesapla
                                const diff = newBytes.length - oldBytes.length;
                                const totalDiff = diff * positions.length;
                                const patched = new Uint8Array(original.length + totalDiff);
                                
                                let srcPos = 0;
                                let dstPos = 0;
                                
                                for (const pos of positions) {
                                  // Eşleşmeden önceki kısmı kopyala
                                  patched.set(original.slice(srcPos, pos), dstPos);
                                  dstPos += (pos - srcPos);
                                  
                                  // Uzunluk prefix'ini güncelle (eşleşmeden 1 byte önce)
                                  if (pos > 0 && original[pos - 1] === oldBytes.length) {
                                    patched[dstPos - 1] = newBytes.length;
                                  }
                                  
                                  // Yeni metni yaz
                                  patched.set(newBytes, dstPos);
                                  dstPos += newBytes.length;
                                  srcPos = pos + oldBytes.length;
                                }
                                
                                // Kalan kısmı kopyala
                                patched.set(original.slice(srcPos), dstPos);

                                const blob = new Blob([patched], { type: 'application/octet-stream' });
                                const a = document.createElement('a');
                                a.href = URL.createObjectURL(blob);
                                a.download = fileName;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(a.href);
                              } else {
                                window.open(rivUrl, "_blank");
                              }
                            } catch {
                              window.open(rivUrl, "_blank");
                            } finally {
                              setDownloading(false);
                            }
                          } else {
                            // Özel metin yok veya orijinal label bilinmiyor — orijinali indir
                            window.open(rivUrl, "_blank");
                          }
                        }}
                        className="w-full py-2 text-xs text-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/60 border border-white/10 disabled:opacity-50"
                      >
                        {downloading ? "İşleniyor..." : `↓ .riv dosyasını indir ${isPro ? "" : `(Kalan: ${remainingDownloads ?? "?"}/5)`}`}
                      </button>
                    )}
                    {/* İndirme hatası */}
                    {downloadError && (
                      <div className="w-full py-2 text-xs text-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 mt-2">
                        {downloadError}
                      </div>
                    )}
                  </div>

                  {/* Sağ: Kod */}
                  <div className="lg:w-1/2 flex flex-col">
                    {/* Framework Sekmeleri */}
                    <div className="flex border-b border-white/5 shrink-0">
                      {FRAMEWORKS.map((fw) => (
                        <button
                          key={fw.id}
                          onClick={() => setActiveFramework(fw.id)}
                          className={`flex-1 px-2 py-3 text-xs font-medium flex flex-col items-center gap-0.5 transition-colors ${
                            activeFramework === fw.id
                              ? "border-b-2 border-[#ff2b73] text-white bg-white/[0.03]"
                              : "text-white/40 hover:text-white/70"
                          }`}
                        >
                          <span className="text-base leading-none">{fw.icon}</span>
                          <span className="font-bold">{fw.label}</span>
                          <span className="text-[9px] opacity-60">{fw.note}</span>
                        </button>
                      ))}
                    </div>

                    {/* Kod */}
                    <div className="relative flex-1">
                      <button
                        disabled={downloading}
                        onClick={() => handleCopy(generatedCode, selectedComp?.id)}
                        className={`absolute top-3 right-3 z-10 px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                          copied
                            ? "bg-green-500/20 text-green-400 border border-green-500/30"
                            : "bg-white text-black hover:bg-gray-200"
                        } disabled:opacity-50`}
                      >
                        {downloading ? "..." : copied ? "✓ Kopyalandı" : "Kopyala"}
                      </button>
                      <pre className="p-5 pt-12 min-h-[280px] text-xs font-mono text-zinc-300 overflow-auto bg-[#050505] leading-relaxed">
                        <code>{generatedCode}</code>
                      </pre>
                    </div>

                    {/* Install komutu */}
                    <div className="px-5 py-3 border-t border-white/5 bg-black/20 shrink-0">
                      <span className="text-[10px] text-white/20 font-mono">
                        {activeFramework === "react" && "npm install @rive-app/react-canvas"}
                        {activeFramework === "js" && "npm install @rive-app/canvas"}
                        {activeFramework === "rn" && "npm install @rive-app/react-native react-native-nitro-modules"}
                        {activeFramework === "flutter" && "flutter pub add rive"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* TAM EKRAN (BÜYÜTEÇ) MODU */}
      {fullscreenPreview && selectedComp && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-xl">
          <button 
            onClick={() => setFullscreenPreview(false)}
            className="absolute top-6 right-6 z-[210] flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-red-500/80 text-white rounded-full transition-all border border-white/20"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            Kapat
          </button>
          
          <div className="w-full h-full max-w-[90vw] max-h-[85vh] flex items-center justify-center">
            <RiveDemo
              src={`https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`}
              artboard={selectedCfg.artboard}
              stateMachines={selectedCfg.stateMachines ?? (selectedCfg.statemachine ? [selectedCfg.statemachine] : [])}
              label={previewText || undefined}
            />
          </div>

          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/50 border border-white/10 rounded-full text-white/50 text-sm backdrop-blur-md">
            Fareyle üzerine gelin veya tıklayarak etkileşime girin.
          </div>
        </div>
      )}
    </>
  );
}
