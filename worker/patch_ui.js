const fs = require('fs');

const file = 'c:/Users/2025/portfolio/ui-src/src/components/ComponentGrid.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Add states
const stateCode = `  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  useEffect(() => {
    if (selectedComp) {
      fetch(\`https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/comments?component_id=\${selectedComp.id}\`)
        .then(res => res.json())
        .then(data => setComments(Array.isArray(data) ? data : []))
        .catch(() => setComments([]));
    } else {
      setComments([]);
      setNewComment("");
    }
  }, [selectedComp]);

  const handlePostComment = async () => {
    if (!newComment.trim() || !user || !selectedComp) return;
    setPostingComment(true);
    try {
      const token = localStorage.getItem("ui_token");
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: \`Bearer \${token}\` },
        body: JSON.stringify({ component_id: selectedComp.id, content: newComment.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setNewComment("");
        alert(data.message || "Yorum gönderildi.");
        const r = await fetch(\`https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/comments?component_id=\${selectedComp.id}\`);
        const c = await r.json();
        setComments(Array.isArray(c) ? c : []);
      } else {
        alert(data.error || "Hata oluştu");
      }
    } catch {
      alert("Hata oluştu");
    } finally {
      setPostingComment(false);
    }
  };
`;

code = code.replace('const [defaultLabels, setDefaultLabels] = useState<Record<string, string>>({});', 'const [defaultLabels, setDefaultLabels] = useState<Record<string, string>>({});\n' + stateCode);

// 2. Add comments section below the main flex content in modal
const commentsSection = `
                {/* Yorumlar Bölümü */}
                <div className="border-t border-white/5 bg-[#0a0a0a] p-8 shrink-0">
                  <div className="max-w-3xl mx-auto">
                    <h4 className="text-xl font-bold mb-6 flex items-center gap-2">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                      Geliştirici Yorumları ({comments.length})
                    </h4>
                    
                    {/* Yorum Listesi */}
                    <div className="space-y-4 mb-8">
                      {comments.length === 0 ? (
                        <p className="text-white/40 text-sm italic">Henüz yorum yapılmamış. İlk yorumu sen yap!</p>
                      ) : (
                        comments.map(c => (
                          <div key={c.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex gap-4">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold shrink-0">
                              {c.full_name?.charAt(0) || '?'}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm">{c.full_name}</span>
                                {c.plan === 'PRO' && (
                                  <span className="px-1.5 py-0.5 text-[9px] font-bold bg-[#ff2b73]/20 text-[#ff2b73] rounded border border-[#ff2b73]/30">PRO</span>
                                )}
                                <span className="text-white/30 text-xs ml-auto">
                                  {new Date(c.created_at).toLocaleDateString('tr-TR')}
                                </span>
                              </div>
                              <p className="text-white/70 text-sm whitespace-pre-wrap">{c.content}</p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Yorum Yapma */}
                    {user ? (
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <textarea
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            placeholder="Bu animasyon hakkında ne düşünüyorsun? (Örn: React Native'de harika çalışıyor!)"
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#ff2b73]/50 transition-colors resize-none h-24"
                          ></textarea>
                          <div className="flex justify-between items-center mt-2">
                            <p className="text-[11px] text-white/30">Yorumunuz yönetici onayından sonra yayınlanacaktır.</p>
                            <button
                              onClick={handlePostComment}
                              disabled={postingComment || !newComment.trim()}
                              className="px-6 py-2 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                            >
                              {postingComment ? "Gönderiliyor..." : "Yorum Yap"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="p-6 rounded-xl border border-white/10 bg-black/40 text-center">
                        <p className="text-white/60 text-sm mb-3">Yorum yapabilmek için ücretsiz üye olmalısınız.</p>
                        <a href="/ui/login" className="px-5 py-2 inline-block bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors border border-white/10">
                          Giriş Yap / Kayıt Ol
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
`;

// Replace `</div>` before `</div></div>` which is the modal wrapper.
// Actually, it's safer to find `</div></div></div>)}` which represents the modal end.
const endOfModalIndex = code.lastIndexOf('</div>\n            </div>\n          </div>\n        </div>\n      )}');

if (endOfModalIndex !== -1 && !code.includes('Geliştirici Yorumları')) {
  // we replace the `</div>` closing `flex-1 overflow-auto`
  code = code.replace('            </div>\n          </div>\n        </div>\n      )}', commentsSection + '\n          </div>\n        </div>\n      )}');
  fs.writeFileSync(file, code);
  console.log("UI patched.");
} else {
  console.log("Could not patch or already patched.");
}
