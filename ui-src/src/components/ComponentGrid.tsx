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

// ─── Kod Üretici (4 framework) ──────────────────────────────────────────────
function generateCode(
  framework: "react" | "js" | "rn" | "flutter",
  cfg: RiveCfg,
  fileName: string,
  title: string
) {
  const ab = cfg.artboard || "";
  const sm = (cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []))[0] ?? "";
  const inputs = cfg.inputs ?? [];
  const triggers = inputs.filter((i) => i.type === 0);
  const booleans = inputs.filter((i) => i.type === 1 && /hover|over|active/i.test(i.name));
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
    c += `    autoplay: true,\n    shouldResizeCanvasToContainer: true,\n  });\n`;

    if (sm) {
      c += `\n  const smInputs = useMemo(\n    () => rive?.stateMachineInputs(STATE_MACHINE) ?? [],\n    [rive],\n  );\n`;
      triggers.forEach((t) => {
        const v = t.name.replace(/\W/g, "_").toLowerCase() + "Input";
        c += `\n  const ${v} = smInputs.find((i) => i.name === "${t.name}");\n`;
        const fn = "fire" + t.name[0].toUpperCase() + t.name.slice(1);
        c += `  const ${fn} = () => { if (${v}) ${v}.fire(); };\n`;
      });
      if (isNative) {
        c += `\n  // Native hover/click — Rive canvas otomatik yönetir, ek kod gerekmez.\n`;
      }
    }

    c += `\n  return (\n    <div className="w-full h-[420px]">\n      <RiveComponent className="w-full h-full" />\n    </div>\n`;
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
    c += `// .riv dosyasını /public/rive/ klasörüne koy\nconst canvas = document.getElementById("rive-canvas");\n\n`;
    c += `const r = new Rive({\n  src: "/rive/${rivFile}",\n  canvas,\n`;
    if (ab) c += `  artboard: "${ab}",\n`;
    if (sm) c += `  stateMachines: "${sm}",\n`;
    c += `  autoplay: true,\n  layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),\n`;
    c += `  onLoad: () => {\n    r.resizeDrawingSurfaceToCanvas();\n`;
    if (sm && triggers.length) {
      c += `    const inputs = r.stateMachineInputs("${sm}");\n`;
      triggers.forEach((t) => {
        c += `    const ${t.name.replace(/\W/g, "_")}Input = inputs.find(i => i.name === "${t.name}");\n`;
      });
      c += `    // Trigger'ı ateşlemek için:\n`;
      triggers.forEach((t) => {
        c += `    // ${t.name.replace(/\W/g, "_")}Input.fire();\n`;
      });
    } else if (isNative) {
      c += `    // Native hover/click — canvas pointer events otomatik çalışır\n`;
    }
    c += `  }\n});\n\n`;
    c += `/* HTML:\n<canvas id="rive-canvas" width="400" height="300"></canvas>\n*/\n`;
    return c;
  }

  if (framework === "rn") {
    let c = `import Rive, { Fit, Alignment } from "@rive-app/react-native";\n`;
    if (sm && triggers.length) c += `import { useRef } from "react";\n`;
    c += `\nexport default function ${fnName}() {\n`;
    if (sm && triggers.length) {
      c += `  const riveRef = useRef(null);\n\n`;
      c += `  const fireBump = () => {\n    riveRef.current?.fireState("${sm}", "${triggers[0].name}");\n  };\n\n`;
    }
    c += `  return (\n    <Rive\n`;
    if (sm && triggers.length) c += `      ref={riveRef}\n`;
    c += `      resourceName="${rivFile.replace(".riv", "")}"\n`;
    if (ab) c += `      artboardName="${ab}"\n`;
    if (sm) c += `      stateMachineName="${sm}"\n`;
    c += `      fit={Fit.Contain}\n      alignment={Alignment.Center}\n      autoplay\n    />\n  );\n}\n\n`;
    c += `/* package.json'a ekle:\n"@rive-app/react-native": "latest"\n\n`;
    c += `assets/animations/${rivFile} klasörüne .riv dosyasını koy */\n`;
    return c;
  }

  if (framework === "flutter") {
    let c = `import 'package:flutter/material.dart';\nimport 'package:rive/rive.dart';\n\n`;
    c += `class ${fnName} extends StatefulWidget {\n  const ${fnName}({super.key});\n  @override\n  State<${fnName}> createState() => _${fnName}State();\n}\n\n`;
    c += `class _${fnName}State extends State<${fnName}> {\n`;
    if (sm && triggers.length) {
      c += `  SMITrigger? _${triggers[0].name.replace(/\W/g, "_")};\n\n`;
      c += `  void _onRiveInit(Artboard artboard) {\n    final ctrl = StateMachineController.fromArtboard(artboard, '${sm}');\n    artboard.addController(ctrl!);\n    _${triggers[0].name.replace(/\W/g, "_")} = ctrl.findInput<bool>('${triggers[0].name}') as SMITrigger?;\n  }\n\n`;
    }
    c += `  @override\n  Widget build(BuildContext context) {\n    return SizedBox(\n      width: 400, height: 300,\n      child: RiveAnimation.asset(\n        'assets/${rivFile}',\n`;
    if (ab) c += `        artboard: '${ab}',\n`;
    if (sm) c += `        stateMachines: ['${sm}'],\n`;
    if (sm && triggers.length) c += `        onInit: _onRiveInit,\n`;
    c += `      ),\n    );\n  }\n}\n\n`;
    c += `/* pubspec.yaml'a ekle:\ndependencies:\n  rive: ^0.12.0\n\nflutter:\n  assets:\n    - assets/${rivFile}\n*/\n`;
    return c;
  }

  return "";
}

// ─── Framework Sekme Konfigürasyonu ─────────────────────────────────────────
const FRAMEWORKS = [
  { id: "react" as const, label: "React", icon: "⚛", note: "Next.js / Vite / CRA" },
  { id: "js" as const, label: "JavaScript", icon: "🌐", note: "Vanilla JS / HTML" },
  { id: "rn" as const, label: "React Native", icon: "📱", note: "iOS & Android" },
  { id: "flutter" as const, label: "Flutter", icon: "🐦", note: "Dart / Cross-platform" },
];

// ─── Ana Bileşen ─────────────────────────────────────────────────────────────
export default function ComponentGrid() {
  const [components, setComponents] = useState<UIComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedComp, setSelectedComp] = useState<UIComponent | null>(null);
  const [activeFramework, setActiveFramework] = useState<"react" | "js" | "rn" | "flutter">("react");
  const [copied, setCopied] = useState(false);

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
    fetchComponents();
  }, []);

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {}
  };

  const selectedCfg = useMemo<RiveCfg>(() => {
    try { return selectedComp?.tags ? JSON.parse(selectedComp.tags) : {}; } catch { return {}; }
  }, [selectedComp]);

  const selectedFileName = useMemo(() => {
    return selectedComp?.image_url?.split("/").pop() ?? "animation.riv";
  }, [selectedComp]);

  const generatedCode = useMemo(() => {
    if (!selectedComp) return "";
    return generateCode(activeFramework, selectedCfg, selectedFileName, selectedComp.title);
  }, [selectedComp, activeFramework, selectedCfg, selectedFileName]);

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
      {/* GRID */}
      <div className="mb-12">
        <div className="text-sm text-white/40 text-right">{components.length} bileşen</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {components.map((comp) => {
          let cfg: RiveCfg = {};
          try { if (comp.tags) cfg = JSON.parse(comp.tags); } catch (_) {}
          const sms = cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []);

          return (
            <div key={comp.id} className="group flex flex-col bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden hover:border-white/10 transition-colors">
              {/* PREVIEW */}
              <div className="relative aspect-[4/3] w-full bg-black/40 overflow-hidden">
                <div className="absolute top-4 right-4 z-10 flex gap-2">
                  {comp.is_featured ? (
                    <span className="px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white">PRO</span>
                  ) : (
                    <span className="px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-white/10 text-white">FREE</span>
                  )}
                </div>
                {comp.image_url ? (
                  <div className="w-full h-full group-hover:scale-105 transition-transform duration-500">
                    <RiveDemo
                      src={`https://vk-portfolio-api.vkesgin38.workers.dev${comp.image_url}`}
                      artboard={cfg.artboard}
                      stateMachines={sms}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-white/20 text-sm">Görsel Yok</div>
                )}
              </div>

              {/* INFO */}
              <div className="p-6 border-t border-white/5 flex-1 flex flex-col">
                <h3 className="text-lg font-semibold mb-1 group-hover:text-[#ff2b73] transition-colors">{comp.title}</h3>
                {sms.length > 0 && (
                  <p className="text-xs text-white/30 font-mono mb-2">
                    {cfg.inputs?.length === 0 ? "✓ hover/click" :
                      cfg.inputs?.some(i => i.type === 0) ? "🎯 tıklama trigger" :
                        "⚙ animasyon"}
                  </p>
                )}
                <div className="mt-auto pt-6 flex gap-2">
                  <button
                    onClick={() => { setSelectedComp(comp); setActiveFramework("react"); }}
                    className="flex-1 py-3 text-sm font-medium rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
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
          <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => setSelectedComp(null)} />
          <div className="relative w-full max-w-4xl bg-[#080808] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02] shrink-0">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold">{selectedComp.title}</h3>
                {selectedComp.is_featured && (
                  <span className="px-2 py-0.5 text-[10px] bg-[#ff2b73]/20 text-[#ff2b73] rounded-full border border-[#ff2b73]/30">PRO</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* .riv İndir */}
                <a
                  href={`https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`}
                  download
                  className="px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white border border-white/10"
                >
                  ↓ .riv
                </a>
                <button onClick={() => setSelectedComp(null)} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {selectedComp.is_featured ? (
                /* PRO PAYWALL */
                <div className="flex flex-col items-center justify-center h-64 text-center p-8">
                  <div className="w-14 h-14 mb-4 rounded-2xl bg-gradient-to-tr from-[#ff2b73] to-[#ff7e5f] flex items-center justify-center shadow-[0_0_40px_rgba(255,43,115,0.4)]">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  </div>
                  <h4 className="text-xl font-bold mb-2">Sadece PRO Üyeler</h4>
                  <p className="text-sm text-white/50 mb-6">Bu bileşenin kaynak koduna erişmek için abonelik gereklidir.</p>
                  <button className="px-6 py-3 rounded-xl bg-white text-black font-semibold hover:scale-105 transition-transform">Abonelik Planlarını Gör</button>
                </div>
              ) : (
                <div className="flex flex-col lg:flex-row h-full">
                  {/* Sol: Animasyon Preview */}
                  <div className="lg:w-2/5 p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20">
                    <div className="w-full max-w-xs aspect-square rounded-2xl overflow-hidden border border-white/10 bg-black/40">
                      <RiveDemo
                        src={`https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`}
                        artboard={selectedCfg.artboard}
                        stateMachines={selectedCfg.stateMachines ?? (selectedCfg.statemachine ? [selectedCfg.statemachine] : [])}
                      />
                    </div>
                    {/* Animasyon tipi badge */}
                    <div className="absolute bottom-4 left-1/4 transform -translate-x-1/2">
                      {selectedCfg.inputs?.length === 0 && (selectedCfg.stateMachines?.length ?? 0) > 0 && (
                        <span className="text-[10px] text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-2 py-1 rounded-full">
                          ✓ hover ile etkileş
                        </span>
                      )}
                      {(selectedCfg.inputs ?? []).some(i => i.type === 0) && (
                        <span className="text-[10px] text-[#ff2b73] bg-[#ff2b73]/10 border border-[#ff2b73]/20 px-2 py-1 rounded-full">
                          🎯 tıkla — ateşle
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Sağ: Kod */}
                  <div className="lg:w-3/5 flex flex-col">
                    {/* Framework Sekmeleri */}
                    <div className="flex border-b border-white/5 shrink-0 overflow-x-auto">
                      {FRAMEWORKS.map((fw) => (
                        <button
                          key={fw.id}
                          onClick={() => setActiveFramework(fw.id)}
                          className={`flex-1 min-w-[80px] px-3 py-3 text-xs font-medium flex flex-col items-center gap-0.5 transition-colors ${
                            activeFramework === fw.id
                              ? "border-b-2 border-[#ff2b73] text-white bg-white/[0.03]"
                              : "text-white/40 hover:text-white/70 hover:bg-white/[0.02]"
                          }`}
                        >
                          <span className="text-base leading-none">{fw.icon}</span>
                          <span className="font-bold">{fw.label}</span>
                          <span className="text-[9px] opacity-60">{fw.note}</span>
                        </button>
                      ))}
                    </div>

                    {/* Kod Alanı */}
                    <div className="relative flex-1">
                      <button
                        onClick={() => handleCopy(generatedCode)}
                        className={`absolute top-3 right-3 z-10 px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                          copied
                            ? "bg-green-500/20 text-green-400 border border-green-500/30"
                            : "bg-white text-black hover:bg-gray-200"
                        }`}
                      >
                        {copied ? "✓ Kopyalandı" : "Kopyala"}
                      </button>
                      <pre className="p-5 pt-12 h-full min-h-[300px] text-xs font-mono text-zinc-300 overflow-auto bg-[#050505] leading-relaxed">
                        <code>{generatedCode}</code>
                      </pre>
                    </div>

                    {/* Install notu */}
                    <div className="px-5 py-3 border-t border-white/5 bg-white/[0.01] shrink-0">
                      {activeFramework === "react" && (
                        <code className="text-[10px] text-white/30 font-mono">npm install @rive-app/react-canvas</code>
                      )}
                      {activeFramework === "js" && (
                        <code className="text-[10px] text-white/30 font-mono">npm install @rive-app/canvas</code>
                      )}
                      {activeFramework === "rn" && (
                        <code className="text-[10px] text-white/30 font-mono">npm install @rive-app/react-native</code>
                      )}
                      {activeFramework === "flutter" && (
                        <code className="text-[10px] text-white/30 font-mono">flutter pub add rive</code>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
