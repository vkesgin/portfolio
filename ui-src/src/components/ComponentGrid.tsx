"use client";

import { useState, useEffect } from "react";
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

export default function ComponentGrid() {
  const [components, setComponents] = useState<UIComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedComp, setSelectedComp] = useState<UIComponent | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchComponents() {
      try {
        const res = await fetch('https://vk-portfolio-api.vkesgin38.workers.dev/api/projects?category=uilib');
        if (res.ok) {
          const data = await res.json();
          setComponents(data);
        }
      } catch (err) {
        console.error("Veri çekilemedi:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchComponents();
  }, []);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Kopyalama başarısız:", err);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 mx-auto mb-4 border-4 border-[#ff2b73] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-white/40">Bileşenler yükleniyor...</p>
      </div>
    );
  }

  if (components.length === 0) {
    return (
      <div className="py-20 text-center border border-white/5 rounded-3xl bg-white/[0.02]">
        <div className="w-16 h-16 mx-auto mb-4 opacity-20">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
        <p className="text-white/40">Henüz bileşen eklenmedi.</p>
        <p className="text-white/20 text-sm mt-2">Admin panelinden ilk bileşenini ekleyebilirsin.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-12">
        <div className="text-sm text-white/40 text-right">{components.length} bileşen</div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {components.map((comp) => (
          <div key={comp.id} className="group flex flex-col bg-white/[0.02] border border-white/5 rounded-3xl overflow-hidden hover:border-white/10 transition-colors">
            
            {/* PREVIEW */}
            <div className="relative aspect-[4/3] w-full bg-black/40 flex items-center justify-center p-8 overflow-hidden">
              <div className="absolute top-4 right-4 z-10 flex gap-2">
                {comp.is_featured ? (
                  <span className="px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-gradient-to-r from-[#ff2b73] to-[#ff7e5f] text-white flex items-center gap-1">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    PRO
                  </span>
                ) : (
                  <span className="px-2 py-1 text-[10px] font-bold tracking-wider rounded bg-white/10 text-white">FREE</span>
                )}
              </div>
              
              {comp.image_url ? (
                <div className="w-full h-full relative group-hover:scale-105 transition-transform duration-500">
                  {(() => {
                    let cfg: { artboard?: string; stateMachines?: string[]; statemachine?: string } = {};
                    try { if (comp.tags) cfg = JSON.parse(comp.tags); } catch(e){}
                    const sms = cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []);
                    return (
                      <RiveDemo
                        src={`https://vk-portfolio-api.vkesgin38.workers.dev${comp.image_url}`}
                        artboard={cfg.artboard}
                        stateMachines={sms}
                      />
                    );
                  })()}
                </div>
              ) : (
                <div className="text-white/20 text-sm">Görsel Yok</div>
              )}
            </div>

            {/* INFO */}
            <div className="p-6 border-t border-white/5 flex-1 flex flex-col">
              <h3 className="text-lg font-semibold mb-2 group-hover:text-[#ff2b73] transition-colors">{comp.title}</h3>
              
              <div className="mt-auto pt-6 flex gap-2">
                <button 
                  onClick={() => setSelectedComp(comp)}
                  className="flex-1 py-3 text-sm font-medium rounded-xl bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  Kodu Göster
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* CODE MODAL */}
      {selectedComp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedComp(null)}></div>
          <div className="relative w-full max-w-3xl bg-[#0a0a0a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            
            <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/[0.02]">
              <div>
                <h3 className="text-xl font-bold flex items-center gap-3">
                  {selectedComp.title}
                  {selectedComp.is_featured && <span className="px-2 py-0.5 text-[10px] bg-[#ff2b73]/20 text-[#ff2b73] rounded-full border border-[#ff2b73]/30">PRO</span>}
                </h3>
              </div>
              <button onClick={() => setSelectedComp(null)} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {selectedComp.is_featured ? (
                /* PRO PAYWALL */
                <div className="w-full h-64 flex flex-col items-center justify-center text-center bg-gradient-to-b from-white/[0.05] to-transparent rounded-2xl border border-white/5 relative overflow-hidden">
                  <div className="absolute inset-0 bg-[#0a0a0a]/60 backdrop-blur-md z-0"></div>
                  <div className="relative z-10 max-w-sm px-6">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-[#ff2b73] to-[#ff7e5f] flex items-center justify-center shadow-[0_0_40px_rgba(255,43,115,0.4)]">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </div>
                    <h4 className="text-xl font-bold mb-2">Sadece PRO Üyeler</h4>
                    <p className="text-sm text-white/50 mb-6">Bu animasyon bileşeninin kaynak koduna erişmek için kütüphane aboneliği gereklidir.</p>
                    <button className="w-full py-3 rounded-xl bg-white text-black font-semibold hover:scale-105 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                      Abonelik Planlarını Gör
                    </button>
                  </div>
                </div>
              ) : (
                /* FREE CODE VIEW */
                <div className="relative group">
                  <div className="flex-1 w-full flex items-center justify-center p-6 lg:p-12">
                        {(() => {
                          let cfg: { artboard?: string; stateMachines?: string[]; statemachine?: string } = {};
                          try { if (selectedComp.tags) cfg = JSON.parse(selectedComp.tags); } catch(e){}
                          const sms = cfg.stateMachines ?? (cfg.statemachine ? [cfg.statemachine] : []);
                          return (
                            <div className="w-full h-full max-h-[500px] border border-white/10 rounded-xl overflow-hidden bg-black/40">
                              <RiveDemo
                                src={`https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`}
                                artboard={cfg.artboard}
                                stateMachines={sms}
                              />
                            </div>
                          );
                        })()}
                      </div>
                  <div className="absolute top-4 right-4 z-10 flex gap-2">
                    <a 
                      href={`https://vk-portfolio-api.vkesgin38.workers.dev${selectedComp.image_url}`}
                      download
                      className="px-4 py-2 text-xs font-medium rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white border border-white/10 backdrop-blur-sm"
                    >
                      .riv İndir
                    </a>
                    <button 
                      onClick={() => handleCopyCode(selectedComp.description)}
                      className="px-4 py-2 text-xs font-medium rounded-lg bg-white text-black hover:bg-gray-200 transition-colors flex items-center gap-2"
                    >
                      {copied ? "Kopyalandı ✓" : "Kodu Kopyala"}
                    </button>
                  </div>
                  <pre className="p-6 rounded-2xl bg-[#050505] text-sm font-mono text-zinc-300 overflow-x-auto border border-white/5">
                    <code>{selectedComp.description || "// Kod eklenmemiş."}</code>
                  </pre>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </>
  );
}
