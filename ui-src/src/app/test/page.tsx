"use client";

import { useState, useEffect } from "react";

export default function TestCommentsPage() {
  const [comments, setComments] = useState<any[]>([
    {
      id: 1,
      full_name: "Veli Kesgin",
      plan: "PRO",
      content: "Bu bir test yorumudur. PRO kullanıcı olduğum için ismimin yanında rozet çıkıyor ve anında yayınlandı!",
      created_at: new Date().toISOString()
    },
    {
      id: 2,
      full_name: "Misafir Kullanıcı",
      plan: "FREE",
      content: "Gerçekten harika bir animasyon. Next.js projeme saniyeler içinde ekledim.",
      created_at: new Date(Date.now() - 86400000).toISOString()
    }
  ]);
  const [newComment, setNewComment] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [userLoggedIn, setUserLoggedIn] = useState(true);

  const handlePost = () => {
    if (!newComment.trim()) return;
    setIsPosting(true);
    setTimeout(() => {
      setComments([
        {
          id: Date.now(),
          full_name: "Sen (Test)",
          plan: "PRO",
          content: newComment,
          created_at: new Date().toISOString()
        },
        ...comments
      ]);
      setNewComment("");
      setIsPosting(false);
    }, 500);
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-4">Yorum Sistemi Test Sayfası</h1>
        <p className="text-white/50 mb-12">
          Geliştirici yorumları bölümünün nasıl göründüğünü aşağıdan inceleyebilirsin. 
          Modal (Açılır pencere) dışında direkt sayfada test edebilirsin.
        </p>

        {/* YORUMLAR BÖLÜMÜ BAŞLANGICI */}
        <div className="border border-white/10 bg-[#0a0a0a] p-8 rounded-3xl w-full shadow-2xl">
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
                <div key={c.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 flex gap-4 transition-all hover:bg-white/5">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#ff2b73] to-[#ff7e5f] flex items-center justify-center text-white font-bold shrink-0 shadow-lg shadow-[#ff2b73]/20">
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

          {/* Test Kontrolleri (Sadece Test Sayfası İçin) */}
          <div className="mb-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-between">
            <span className="text-blue-400 text-sm font-medium">Test Durumu: {userLoggedIn ? "Giriş Yapılmış" : "Ziyaretçi (Giriş Yapılmamış)"}</span>
            <button 
              onClick={() => setUserLoggedIn(!userLoggedIn)}
              className="text-xs px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 rounded-lg transition-colors"
            >
              Durumu Değiştir
            </button>
          </div>

          {/* Yorum Yapma Kutusu */}
          {userLoggedIn ? (
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
                    onClick={handlePost}
                    disabled={isPosting || !newComment.trim()}
                    className="px-6 py-2 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                    {isPosting ? "Gönderiliyor..." : "Yorum Yap"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-xl border border-white/10 bg-black/40 text-center">
              <p className="text-white/60 text-sm mb-3">Yorum yapabilmek için ücretsiz üye olmalısınız.</p>
              <a href="#" className="px-5 py-2 inline-block bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors border border-white/10">
                Giriş Yap / Kayıt Ol
              </a>
            </div>
          )}
        </div>
        {/* YORUMLAR BÖLÜMÜ BİTİŞİ */}

      </div>
    </main>
  );
}
