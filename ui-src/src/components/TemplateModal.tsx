"use client";
import { useState, useMemo } from "react";
import { findOrigTextInBinary, applyTextPatch } from "../utils/rivePatch";
import { generateCode, RiveCfg, FRAMEWORKS } from "../utils/riveCodeGen";
import RiveDemo from "./RiveDemo";

interface Props {
  comp: { id: string; title: string; description: string; image_url: string; is_featured: boolean; tags?: string; thumbnail_url?: string };
  user: any;
  isPro: boolean;
  onClose: () => void;
}

export default function TemplateModal({ comp, user, isPro, onClose }: Props) {
  const [activeFramework, setActiveFramework] = useState<"react"|"js"|"rn"|"flutter">("react");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string|null>(null);
  const [customTexts, setCustomTexts] = useState<Record<string,string>>({});
  const [previewTexts, setPreviewTexts] = useState<Record<string,string>>({});
  const [fullscreen, setFullscreen] = useState(false);
  const [defaultLabel, setDefaultLabel] = useState("");
  const [defaultLabels, setDefaultLabels] = useState<Record<string,string>>({});
  const [remainingDownloads, setRemainingDownloads] = useState<number|null>(user?.remaining_downloads ?? null);
  const [toast, setToast] = useState<{msg:string;type:"success"|"error"|"info"}|null>(null);

  const cfg = useMemo<RiveCfg>(() => { try { return comp.tags ? JSON.parse(comp.tags) : {}; } catch { return {}; } }, [comp]);
  const fileName = useMemo(() => comp.image_url?.split("/").pop() ?? "template.riv", [comp]);
  const sms = cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []);

  const generatedCode = useMemo(() => {
    const firstCustom = Object.values(customTexts)[0] || "";
    let customPropName = "";
    if (cfg.viewModelProps?.length) customPropName = cfg.viewModelProps[0].name;
    else customPropName = Object.keys(customTexts)[0] || "";
    return generateCode(activeFramework, cfg, fileName, comp.title, firstCustom, customPropName);
  }, [comp, activeFramework, cfg, fileName, customTexts]);

  const trackDownload = async (type: "code"|"riv"): Promise<boolean> => {
    const token = localStorage.getItem("ui_token");
    if (!token) return false;
    setDownloadError(null); setDownloading(true);
    try {
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/download", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ component_id: comp.id, download_type: type }),
      });
      const data = await res.json();
      if (res.ok) { setRemainingDownloads(data.remainingDownloads); return true; }
      setDownloadError(data.error); setToast({ msg: data.error, type: "error" }); return false;
    } catch { setDownloadError("Sunucu hatası"); return false; } finally { setDownloading(false); }
  };

  const handleCopy = async () => {
    const ok = await trackDownload("code");
    if (!ok) return;
    try { await navigator.clipboard.writeText(generatedCode); setCopied(true); setTimeout(() => setCopied(false), 2000); setToast({ msg: "Kod kopyalandı!", type: "success" }); } catch {}
  };

  const handleDownloadRiv = async () => {
    setDownloading(true);
    const rivUrl = `https://vk-portfolio-api.vkesgin38.workers.dev${comp.image_url}`;
    try {
      const ok = await trackDownload("riv");
      if (!ok) { setDownloading(false); return; }
      const textsToApply = Object.values(previewTexts).some(v => v.length > 0) ? previewTexts : customTexts;
      const hasAnyText = Object.values(textsToApply).some(v => v.length > 0);
      if (!hasAnyText) { window.open(rivUrl, "_blank"); setDownloading(false); return; }
      const resp = await fetch(rivUrl); const buf = await resp.arrayBuffer();
      let result = new Uint8Array(buf);
      for (const [propName, newText] of Object.entries(textsToApply)) {
        if (!newText) continue;
        let origText = defaultLabels[propName] || "";
        if (!origText && (propName === "label" || propName === "label ")) origText = defaultLabel || "";
        if (!origText) origText = findOrigTextInBinary(result, propName);
        if (!origText || origText === newText) continue;
        result = applyTextPatch(result, origText, newText) as Uint8Array<ArrayBuffer>;
      }
      const blob = new Blob([result.buffer as ArrayBuffer], { type: "application/octet-stream" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
    } catch { window.open(rivUrl, "_blank"); } finally { setDownloading(false); }
  };

  const isLocked = comp.is_featured && !isPro;

  const previewPanel = (
    <div className="relative w-full max-w-md rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-[0_0_40px_rgba(255,43,115,0.05)]" style={{ height: "300px" }}>
      <div className="absolute" style={{ inset: "20px", display: "flex" }}>
        <RiveDemo key={JSON.stringify(previewTexts)} src={`https://vk-portfolio-api.vkesgin38.workers.dev${comp.image_url}`} artboard={cfg.artboard} stateMachines={sms} labels={Object.keys(previewTexts).length > 0 ? previewTexts : undefined} onDefaultLabel={setDefaultLabel} onDefaultLabels={setDefaultLabels} viewModelName={cfg.viewModelProps?.[0]?.vmName} fallbackDefaults={defaultLabels} />
      </div>
      {!isLocked && <button onClick={() => setFullscreen(true)} className="absolute bottom-3 right-3 p-2 bg-black/60 hover:bg-[#ff2b73] text-white rounded-xl backdrop-blur-md transition-all border border-white/10 group" title="Büyük Ekranda İncele">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
      </button>}
    </div>
  );

  const textCustomizer = (
    <div className="w-full max-w-md bg-white/[0.02] border border-white/10 rounded-xl p-4 mt-2">
      <label className="block text-xs font-semibold text-white/50 mb-2">{(cfg.viewModelProps?.length ?? 0) > 1 ? "Metinleri Özelleştir" : "Buton Yazısını Özelleştir"}</label>
      <div className="flex flex-col gap-2">
        {(cfg.viewModelProps?.length ? cfg.viewModelProps : [{ name: "label", defaultValue: defaultLabel || "", vmName: "" }]).map((prop) => {
          const cleanDefault = prop.defaultValue ? prop.defaultValue.replace(/[^\p{L}\p{N}\s!?.,'"\-:]/gu, "").trim() : "";
          return (
            <div key={prop.name} className="flex gap-2">
              <div className="flex-1 flex flex-col gap-1">
                {(cfg.viewModelProps?.length ?? 0) > 1 && <span className="text-[10px] text-[#7c3aed] font-mono">{prop.name.trim()}</span>}
                <input type="text" value={customTexts[prop.name] || ""} onChange={(e) => setCustomTexts(prev => ({ ...prev, [prop.name]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") setPreviewTexts({ ...customTexts }); }} placeholder={cleanDefault.length > 0 && cleanDefault.length < 30 ? `Varsayılan: ${cleanDefault}` : "Örn: Satın Al"} className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#ff2b73]/50 transition-colors" />
              </div>
            </div>
          );
        })}
        <div className="flex gap-2 mt-1">
          <button onClick={() => setPreviewTexts({ ...customTexts })} className="flex-1 px-4 py-2 bg-white/10 hover:bg-[#ff2b73] text-white text-sm font-medium rounded-lg transition-colors border border-white/10">Önizle</button>
          {Object.keys(previewTexts).length > 0 && <button onClick={() => { setPreviewTexts({}); setCustomTexts({}); }} className="px-3 py-2 bg-white/5 hover:bg-red-500/30 text-white/50 text-sm rounded-lg transition-colors border border-white/10" title="Sıfırla">✕</button>}
        </div>
      </div>
      <p className="text-[10px] text-white/30 mt-2">Yazdığınız metin, kopyaladığınız koda <code className="text-[#ff2b73]">setTextRunValue()</code> olarak eklenir.</p>
    </div>
  );

  return (
    <>
      {toast && <div className={`fixed bottom-8 right-8 z-[2000] px-6 py-4 rounded-2xl border shadow-2xl transition-all flex items-center gap-3 backdrop-blur-xl ${toast.type === "success" ? "bg-[#050505]/90 border-green-500/50 text-green-400" : toast.type === "error" ? "bg-[#050505]/90 border-red-500/50 text-red-400" : "bg-[#050505]/90 border-blue-500/50 text-blue-400"}`}>
        <div className={`w-2 h-2 rounded-full ${toast.type === "success" ? "bg-green-500" : toast.type === "error" ? "bg-red-500" : "bg-blue-500"} animate-pulse`}></div>
        <span className="font-bold text-xs tracking-wide uppercase">{toast.msg}</span>
      </div>}

      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
        <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={() => { onClose(); }} />
        <div className="relative w-full max-w-5xl bg-[#080808] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02] shrink-0">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold">{comp.title}</h3>
              {comp.is_featured && <span className="px-2 py-0.5 text-[10px] bg-[#ff2b73]/20 text-[#ff2b73] rounded-full border border-[#ff2b73]/30">PRO</span>}
            </div>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            {!user ? (
              /* Giriş Gerekli */
              <div className="flex flex-col lg:flex-row" style={{ minHeight: "400px" }}>
                <div className="lg:w-2/5 p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20">{previewPanel}</div>
                <div className="lg:w-3/5 flex flex-col items-center justify-center p-8 text-center">
                  <div className="w-16 h-16 mb-5 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
                  </div>
                  <h4 className="text-2xl font-bold mb-3">Giriş Yapmanız Gerekiyor</h4>
                  <p className="text-white/50 mb-2 max-w-sm">Bu şablonun kaynak koduna ve <code className="text-[#ff2b73]">.riv</code> dosyasına erişmek için ücretsiz üye olmalısınız.</p>
                  <p className="text-white/30 text-sm mb-8">Önizlemeyi ücretsiz görebilirsiniz.</p>
                  <div className="flex gap-4">
                    <a href="/ui/login" className="px-6 py-3 rounded-xl bg-white text-black font-semibold hover:bg-gray-200 transition-colors">Giriş Yap</a>
                    <a href="/ui/register" className="px-6 py-3 rounded-xl bg-white/10 font-semibold hover:bg-white/20 transition-colors border border-white/10">Kayıt Ol</a>
                  </div>
                </div>
              </div>
            ) : isLocked ? (
              /* PRO Paywall */
              <div className="flex flex-col lg:flex-row" style={{ minHeight: "400px" }}>
                <div className="lg:w-2/5 p-6 flex items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20">{previewPanel}</div>
                <div className="lg:w-3/5 flex flex-col items-center justify-center p-8 text-center">
                  <div className="w-16 h-16 mb-5 rounded-2xl bg-gradient-to-tr from-[#ff2b73] to-[#ff7e5f] flex items-center justify-center shadow-[0_0_40px_rgba(255,43,115,0.4)]">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  </div>
                  <h4 className="text-2xl font-bold mb-3">PRO Üyelik Gerekli</h4>
                  <p className="text-white/50 mb-2 max-w-sm">Bu şablonun kaynak kodu ve <code className="text-[#ff2b73]">.riv</code> dosyası PRO üyelere özeldir.</p>
                  <p className="text-white/30 text-sm mb-8">Önizlemeyi ücretsiz görebilirsiniz.</p>
                  <a href="/ui/pricing" className="px-8 py-3 rounded-xl bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white font-semibold hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,43,115,0.3)]">Sınırları Kaldır & PRO'ya Geç →</a>
                </div>
              </div>
            ) : (
              /* Tam Erişim */
              <div className="flex flex-col lg:flex-row" style={{ minHeight: "500px" }}>
                <div className="lg:w-1/2 p-6 flex flex-col items-center justify-center border-b lg:border-b-0 lg:border-r border-white/5 bg-black/20 gap-4">
                  {previewPanel}
                  {textCustomizer}
                  {remainingDownloads !== null && remainingDownloads === 0 && !isPro ? (
                    <div className="w-full py-3 text-xs text-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">Aylık indirme limitiniz doldu (0/5)<a href="/ui/pricing" className="block mt-1 text-[#ff2b73] hover:underline">PRO'ya geç →</a></div>
                  ) : (
                    <button disabled={downloading} onClick={handleDownloadRiv} className="w-full max-w-md py-2 text-xs text-center rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-white/60 border border-white/10 disabled:opacity-50">
                      {downloading ? "Dosya Hazırlanıyor..." : `↓ Ücretsiz İndir (.riv) ${isPro ? "" : `(Kalan: ${remainingDownloads ?? "?"}/5)`}`}
                    </button>
                  )}
                  {downloadError && <div className="w-full py-2 text-xs text-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 mt-2">{downloadError}</div>}
                </div>
                <div className="lg:w-1/2 flex flex-col">
                  <div className="flex border-b border-white/5 shrink-0">
                    {FRAMEWORKS.map((fw) => (
                      <button key={fw.id} onClick={() => setActiveFramework(fw.id)} className={`flex-1 px-2 py-3 text-xs font-medium flex flex-col items-center gap-0.5 transition-colors ${activeFramework === fw.id ? "border-b-2 border-[#ff2b73] text-white bg-white/[0.03]" : "text-white/40 hover:text-white/70"}`}>
                        <span className="text-base leading-none">{fw.icon}</span>
                        <span className="font-bold">{fw.label}</span>
                        <span className="text-[9px] opacity-60">{fw.note}</span>
                      </button>
                    ))}
                  </div>
                  <div className="relative flex-1">
                    <button disabled={downloading} onClick={handleCopy} className={`absolute top-3 right-3 z-10 px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${copied ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-white text-black hover:bg-gray-200"} disabled:opacity-50`}>
                      {downloading ? "..." : copied ? "✓ Kopyalandı" : "Kopyala"}
                    </button>
                    <pre className="p-5 pt-12 min-h-[280px] text-xs font-mono text-zinc-300 overflow-auto bg-[#050505] leading-relaxed"><code>{generatedCode}</code></pre>
                  </div>
                  <div className="px-5 py-3 border-t border-white/5 bg-black/20 shrink-0">
                    <span className="text-[10px] text-white/20 font-mono">
                      {activeFramework === "react" && "npm install @rive-app/react-canvas"}
                      {activeFramework === "js" && "npm install @rive-app/canvas"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {fullscreen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-xl">
          <button onClick={() => setFullscreen(false)} className="absolute top-6 right-6 z-[210] flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-red-500/80 text-white rounded-full transition-all border border-white/20">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>Kapat
          </button>
          <div className="w-full h-full max-w-[90vw] max-h-[85vh] flex items-center justify-center">
            <RiveDemo key={JSON.stringify(previewTexts)} src={`https://vk-portfolio-api.vkesgin38.workers.dev${comp.image_url}`} artboard={cfg.artboard} stateMachines={sms} labels={Object.keys(previewTexts).length > 0 ? previewTexts : undefined} viewModelName={cfg.viewModelProps?.[0]?.vmName} fallbackDefaults={defaultLabels} />
          </div>
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/50 border border-white/10 rounded-full text-white/50 text-sm backdrop-blur-md">Fareyle üzerine gelin veya tıklayarak etkileşime girin.</div>
        </div>
      )}
    </>
  );
}
