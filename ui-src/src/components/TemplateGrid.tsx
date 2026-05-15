"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import RiveDemo from "./RiveDemo";

interface UITemplate {
  id: string;
  title: string;
  category: string;
  description: string;
  image_url: string;
  is_featured: boolean;
  tags?: string;
  thumbnail_url?: string;
}

interface RiveCfg {
  artboard?: string;
  stateMachines?: string[];
  statemachine?: string;
}

export default function TemplateGrid() {
  const [templates, setTemplates] = useState<UITemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [compRes, userRes] = await Promise.all([
          fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/projects?category=uitemplate"),
          (async () => {
            const token = localStorage.getItem("ui_token");
            if (!token) return null;
            const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/me", {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (res.ok) {
              const data = await res.json();
              return data.user;
            }
            return null;
          })()
        ]);

        if (compRes.ok) {
          setTemplates(await compRes.json());
        }
        setUser(userRes);
      } catch (err) {
        console.error("Veri çekilemedi:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const isPro = user?.plan === "PRO";

  const trackDownload = async (componentId: string, type: "code" | "riv"): Promise<boolean> => {
    const token = localStorage.getItem("ui_token");
    if (!token) return false;
    setDownloadError(null);
    setDownloadingId(componentId);
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
        setUser((prev: any) => prev ? { ...prev, remaining_downloads: data.remaining_downloads } : null);
      }
      return true;
    } catch {
      setDownloadError("Sunucu hatası");
      return false;
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCopy = async (id: string, code: string) => {
    if (!user) {
      alert("Kodu kopyalamak için ücretsiz üye girişi yapmalısınız.");
      return;
    }
    const ok = await trackDownload(id, "code");
    if (!ok) {
      alert(downloadError || "İndirme limiti veya bir hata oluştu.");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (_) {}
  };

  const handleDownloadRiv = async (id: string, url: string) => {
    if (!user) {
      alert("Dosyayı indirmek için ücretsiz üye girişi yapmalısınız.");
      return;
    }
    const ok = await trackDownload(id, "riv");
    if (ok) {
      window.open(`https://vk-portfolio-api.vkesgin38.workers.dev${url}`, "_blank");
    } else {
      alert(downloadError || "İndirme limiti veya bir hata oluştu.");
    }
  };

  if (loading) return (
    <div className="py-20 text-center">
      <div className="w-8 h-8 mx-auto mb-4 border-4 border-[#ff2b73] border-t-transparent rounded-full animate-spin" />
      <p className="text-white/40">Şablonlar yükleniyor...</p>
    </div>
  );

  if (templates.length === 0) return (
    <div className="py-20 text-center border border-white/5 rounded-3xl bg-white/[0.02]">
      <p className="text-white/40">Henüz şablon eklenmedi.</p>
      <p className="text-white/20 text-sm mt-2">Admin panelinden 'Şablon' kategorisinde yeni içerik ekleyebilirsiniz.</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
      {templates.map((tpl) => {
        let cfg: RiveCfg = {};
        try { if (tpl.tags) cfg = JSON.parse(tpl.tags); } catch (_) {}
        const sms = cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []);

        const isLocked = tpl.is_featured && !isPro;

        return (
          <div key={tpl.id} className="group flex flex-col bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden hover:border-white/10 transition-all hover:shadow-2xl hover:shadow-[#ff2b73]/5">
            {/* PREVIEW CONTAINER - LARGER THAN COMPONENTS */}
            <div className="relative w-full bg-black/60 border-b border-white/5" style={{ height: "320px" }}>
              <div className="absolute top-4 right-4 z-10 flex gap-2 pointer-events-none">
                {tpl.is_featured ? (
                  <span className="px-3 py-1.5 text-[10px] font-black tracking-widest rounded-full bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white shadow-lg shadow-[#ff2b73]/20">PRO ŞABLON</span>
                ) : (
                  <span className="px-3 py-1.5 text-[10px] font-black tracking-widest rounded-full bg-white/10 text-white backdrop-blur-md">ÜCRETSİZ</span>
                )}
              </div>

              {tpl.image_url ? (
                <div style={{ position: "absolute", inset: "0", display: "flex", filter: isLocked ? "blur(8px) brightness(0.5)" : "none", transition: "filter 0.3s ease" }}>
                  {tpl.thumbnail_url && (
                    <img 
                      src={`https://vk-portfolio-api.vkesgin38.workers.dev${tpl.thumbnail_url}`} 
                      alt={`${tpl.title} - Ücretsiz Rive Şablonları`} 
                      className="sr-only" 
                    />
                  )}
                  <RiveDemo
                    src={`https://vk-portfolio-api.vkesgin38.workers.dev${tpl.image_url}`}
                    artboard={cfg.artboard}
                    stateMachines={sms}
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/20 text-sm">Görsel Yok</div>
              )}

              {/* PAYWALL OVERLAY */}
              {isLocked && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-black/40">
                  <div className="w-16 h-16 rounded-2xl bg-[#ff2b73]/20 border border-[#ff2b73]/30 flex items-center justify-center text-3xl mb-4 backdrop-blur-sm shadow-xl shadow-[#ff2b73]/20">
                    🔒
                  </div>
                  <h4 className="text-xl font-bold text-white mb-2">Bu Şablon PRO Üyelere Özel</h4>
                  <p className="text-white/60 text-sm mb-6 max-w-xs">Tüm premium şablonlara ve kaynak kodlarına erişmek için hesabınızı yükseltin.</p>
                  <Link href="/pricing" className="px-6 py-3 rounded-xl bg-white text-black font-bold text-sm hover:bg-white/90 transition-all hover:scale-105 active:scale-95">
                    Sınırları Kaldır & PRO'ya Geç
                  </Link>
                </div>
              )}
            </div>

            {/* INFO & CODE */}
            <div className="p-8 flex-1 flex flex-col">
              <h3 className="text-2xl font-bold mb-2 text-white/90 group-hover:text-white transition-colors">{tpl.title}</h3>
              
              {/* Note: the code generator for templates will likely provide full boilerplate, which is stored in description */}
              
              <div className="mt-auto pt-6 border-t border-white/5 flex flex-col gap-3">
                {!user ? (
                  <Link href="/login" className="w-full py-4 rounded-xl bg-white/5 text-white/80 font-semibold border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
                    Kodu Almak İçin Giriş Yap
                  </Link>
                ) : isLocked ? (
                  <button disabled className="w-full py-4 rounded-xl bg-white/5 text-white/30 font-semibold cursor-not-allowed border border-white/5">
                    Kaynak Kod Kilitli
                  </button>
                ) : (
                  <>
                    <button
                      disabled={downloadingId === tpl.id}
                      onClick={() => handleDownloadRiv(tpl.id, tpl.image_url)}
                      className="w-full py-3 text-sm font-bold rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2 border border-white/10 text-white/80 disabled:opacity-50"
                    >
                      {downloadingId === tpl.id ? "Hazırlanıyor..." : "Ücretsiz İndir (.riv)"}
                    </button>
                    <button
                      onClick={() => handleCopy(tpl.id, tpl.description)}
                      className="w-full py-3 text-sm font-bold rounded-xl bg-[#ff2b73]/10 text-[#ff2b73] hover:bg-[#ff2b73]/20 transition-colors flex items-center justify-center gap-2 border border-[#ff2b73]/20 hover:border-[#ff2b73]/40"
                    >
                      {copiedId === tpl.id ? (
                        <>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          Kopyalandı!
                        </>
                      ) : (
                        <>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                          Tüm Kodu Kopyala
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
