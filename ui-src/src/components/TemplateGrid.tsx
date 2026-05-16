"use client";

import { useState, useEffect, useMemo } from "react";
import RiveDemo from "./RiveDemo";
import TemplateModal from "./TemplateModal";

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
  const [selectedTpl, setSelectedTpl] = useState<UITemplate | null>(null);
  const [activeFilter, setActiveFilter] = useState<"all" | "free" | "pro">("all");

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
            if (res.ok) { const data = await res.json(); return data.user; }
            return null;
          })()
        ]);
        if (compRes.ok) setTemplates(await compRes.json());
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

  const filteredTemplates = useMemo(() => {
    return templates.filter(tpl => {
      if (activeFilter === "free" && tpl.is_featured) return false;
      if (activeFilter === "pro" && !tpl.is_featured) return false;
      return true;
    });
  }, [templates, activeFilter]);

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
    <>
      {/* FILTER BAR */}
      <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
        <div className="flex flex-wrap items-center gap-2 p-1 rounded-2xl bg-white/5 border border-white/10 w-full md:w-auto overflow-x-auto">
          {[
            { id: "all", label: "Tümü" },
            { id: "free", label: "Ücretsiz" },
            { id: "pro", label: "PRO" },
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
        <div className="text-sm text-white/40">{filteredTemplates.length} şablon gösteriliyor</div>
      </div>

      {/* GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {filteredTemplates.map((tpl) => {
          let cfg: RiveCfg = {};
          try { if (tpl.tags) cfg = JSON.parse(tpl.tags); } catch (_) {}
          const sms = cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []);

          return (
            <div key={tpl.id} className="group flex flex-col bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden hover:border-white/10 transition-all hover:shadow-2xl hover:shadow-[#ff2b73]/5">
              {/* PREVIEW — herkes görebilir */}
              <div className="relative w-full bg-black/60 border-b border-white/5" style={{ height: "320px" }}>
                <div className="absolute top-4 right-4 z-10 flex gap-2 pointer-events-none">
                  {tpl.is_featured ? (
                    <span className="px-3 py-1.5 text-[10px] font-black tracking-widest rounded-full bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white shadow-lg shadow-[#ff2b73]/20">PRO ŞABLON</span>
                  ) : (
                    <span className="px-3 py-1.5 text-[10px] font-black tracking-widest rounded-full bg-white/10 text-white backdrop-blur-md">ÜCRETSİZ</span>
                  )}
                </div>

                {tpl.image_url ? (
                  <div style={{ position: "absolute", inset: "0", display: "flex" }}>
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
              </div>

              {/* INFO & BUTTON */}
              <div className="p-8 flex-1 flex flex-col">
                <h3 className="text-2xl font-bold mb-2 text-white/90 group-hover:text-white transition-colors">{tpl.title}</h3>
                {sms.length > 0 && (
                  <p className="text-[11px] font-mono mb-3">
                    <span className="text-cyan-400">✦ interaktif şablon</span>
                  </p>
                )}
                <div className="mt-auto pt-6 border-t border-white/5">
                  <button
                    onClick={() => setSelectedTpl(tpl)}
                    className="w-full py-4 text-sm font-medium rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Projende Dene & Kodu Al
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL */}
      {selectedTpl && (
        <TemplateModal
          comp={selectedTpl}
          user={user}
          isPro={isPro}
          onClose={() => setSelectedTpl(null)}
        />
      )}
    </>
  );
}
