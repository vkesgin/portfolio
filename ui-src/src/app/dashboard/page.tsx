"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface User {
  id: number;
  email: string;
  full_name: string;
  plan: string;
  subscription_end: string | null;
  remaining_downloads?: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile Edit States
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [fullName, setFullName] = useState("");
  const [profileMsg, setProfileMsg] = useState({ text: "", type: "" });
  const [updatingProfile, setUpdatingProfile] = useState(false);

  // Password Change States
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState({ text: "", type: "" });
  const [updatingPassword, setUpdatingPassword] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem("ui_token");
      if (!token) {
        router.push("/login");
        return;
      }

      try {
        const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error);
        }

        setUser(data.user);
        setFullName(data.user.full_name || "");
      } catch (err) {
        console.error(err);
        localStorage.removeItem("ui_token");
        router.push("/login");
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("ui_token");
    router.push("/login");
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg({ text: "", type: "" });
    setUpdatingProfile(true);
    try {
      const token = localStorage.getItem("ui_token");
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ full_name: fullName })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Güncelleme başarısız");
      
      setUser({ ...user!, full_name: data.user.full_name });
      setProfileMsg({ text: "Profil başarıyla güncellendi.", type: "success" });
      setTimeout(() => setIsEditingProfile(false), 2000);
    } catch (err: any) {
      setProfileMsg({ text: err.message, type: "error" });
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg({ text: "", type: "" });
    
    if (newPassword !== confirmNewPassword) {
      setPasswordMsg({ text: "Yeni şifreler birbiriyle eşleşmiyor.", type: "error" });
      return;
    }
    
    setUpdatingPassword(true);
    try {
      const token = localStorage.getItem("ui_token");
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ 
          currentPassword,
          newPassword
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Şifre değiştirme başarısız");
      
      setPasswordMsg({ text: "Şifreniz başarıyla değiştirildi.", type: "success" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setTimeout(() => setIsEditingPassword(false), 2000);
    } catch (err: any) {
      setPasswordMsg({ text: err.message, type: "error" });
    } finally {
      setUpdatingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#ff2b73] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) return null;

  const isPro = user.plan === "PRO";

  return (
    <main className="min-h-screen bg-[#050505] text-white pt-32 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-12 gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Merhaba, {user.full_name || user.email.split('@')[0]}</h1>
            <p className="text-white/50">Kütüphanenize ve abonelik bilgilerinize buradan ulaşabilirsiniz.</p>
          </div>
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors border border-white/10"
          >
            Çıkış Yap
          </button>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {/* Plan Card */}
          <div className={`col-span-2 p-8 rounded-3xl border ${isPro ? 'border-[#ff2b73]/30 bg-[#ff2b73]/5' : 'border-white/10 bg-white/5'} relative overflow-hidden`}>
            {isPro && (
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#ff2b73]/20 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
            )}
            <h3 className="text-xl font-bold mb-1 relative z-10">Mevcut Planınız</h3>
            <div className="flex items-center gap-3 mb-6 relative z-10">
              <span className={`text-3xl font-black tracking-tight ${isPro ? 'text-[#ff2b73]' : 'text-white'}`}>
                {isPro ? 'PRO' : 'ÜCRETSİZ'}
              </span>
              {isPro && user.subscription_end && (
                <span className="text-xs px-2 py-1 rounded-md bg-[#ff2b73]/20 text-[#ff2b73] font-medium">
                  Bitiş: {new Date(user.subscription_end).toLocaleDateString('tr-TR')}
                </span>
              )}
            </div>
            
            {!isPro ? (
              <div>
                <p className="text-white/60 mb-6 text-sm">PRO pakete geçerek kütüphanedeki tüm özel bileşenlere ve şablonlara anında erişim sağlayın.</p>
                <Link href="/pricing" className="inline-block px-6 py-3 rounded-xl bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-bold transition-all text-sm">
                  PRO'ya Yükselt
                </Link>
              </div>
            ) : (
              <div>
                <p className="text-white/60 mb-6 text-sm">Tüm premium bileşenlere ve kaynak kodlarına sınırsız erişiminiz var. Projelerinizde harikalar yaratın!</p>
                <div className="flex gap-4">
                  <Link href="/" className="inline-block px-6 py-3 rounded-xl bg-white text-black hover:bg-white/90 font-bold transition-all text-sm">
                    Bileşenleri Keşfet
                  </Link>
                  <a href="https://velikesgin.lemonsqueezy.com/billing" target="_blank" rel="noopener noreferrer" className="inline-block px-6 py-3 rounded-xl bg-white/10 text-white hover:bg-white/20 font-bold transition-all text-sm border border-white/10">
                    Aboneliği Yönet
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* User Details Card */}
          <div className="p-8 rounded-3xl border border-white/10 bg-white/5 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white/50">Hesap Bilgileri</h3>
              {!isEditingProfile && !isEditingPassword && (
                <div className="flex gap-2">
                  <button 
                    onClick={() => setIsEditingProfile(true)} 
                    className="text-xs px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    Profili Düzenle
                  </button>
                  <button 
                    onClick={() => setIsEditingPassword(true)} 
                    className="text-xs px-3 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    Şifre Değiştir
                  </button>
                </div>
              )}
            </div>
            
            {profileMsg.text && isEditingProfile && (
              <div className={`mb-4 p-3 rounded-lg text-sm border ${profileMsg.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
                {profileMsg.text}
              </div>
            )}
            {passwordMsg.text && isEditingPassword && (
              <div className={`mb-4 p-3 rounded-lg text-sm border ${passwordMsg.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
                {passwordMsg.text}
              </div>
            )}

            {!isEditingProfile && !isEditingPassword && (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-white/40 mb-1">E-posta</div>
                  <div className="font-medium text-sm truncate">{user.email}</div>
                </div>
                <div>
                  <div className="text-xs text-white/40 mb-1">Ad Soyad</div>
                  <div className="font-medium text-sm">{user.full_name || '-'}</div>
                </div>
              </div>
            )}

            {isEditingProfile && (
              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">E-posta (Değiştirilemez)</label>
                  <input type="text" disabled value={user.email} className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/5 text-white/50 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Ad Soyad</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 focus:border-[#ff2b73] outline-none text-white text-sm" />
                </div>
                <div className="flex gap-2 mt-2">
                  <button type="submit" disabled={updatingProfile} className="flex-1 py-2 rounded-lg bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-bold text-sm transition-colors disabled:opacity-50">
                    {updatingProfile ? "Güncelleniyor..." : "Kaydet"}
                  </button>
                  <button type="button" onClick={() => { setIsEditingProfile(false); setProfileMsg({ text: "", type: "" }); setFullName(user.full_name || ""); }} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-sm transition-colors">
                    İptal
                  </button>
                </div>
              </form>
            )}

            {isEditingPassword && (
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Mevcut Şifre</label>
                  <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 focus:border-[#ff2b73] outline-none text-white text-sm" placeholder="••••••••" />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Yeni Şifre</label>
                  <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 focus:border-[#ff2b73] outline-none text-white text-sm" placeholder="••••••••" minLength={6} />
                </div>
                <div>
                  <label className="text-xs text-white/40 mb-1 block">Yeni Şifre (Tekrar)</label>
                  <input type="password" required value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-black/50 border border-white/10 focus:border-[#ff2b73] outline-none text-white text-sm" placeholder="••••••••" minLength={6} />
                </div>
                <div className="flex gap-2 mt-2">
                  <button type="submit" disabled={updatingPassword} className="flex-1 py-2 rounded-lg bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-bold text-sm transition-colors disabled:opacity-50">
                    {updatingPassword ? "Şifreyi Değiştir..." : "Şifreyi Değiştir"}
                  </button>
                  <button type="button" onClick={() => { setIsEditingPassword(false); setPasswordMsg({ text: "", type: "" }); setCurrentPassword(""); setNewPassword(""); setConfirmNewPassword(""); }} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold text-sm transition-colors">
                    İptal
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* PRO Kilitli İçerik Uyarısı */}
        {!isPro && (
          <div className="p-6 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 text-xl">
                🔒
              </div>
              <div>
                <h4 className="font-bold text-yellow-500">Premium Bileşenler Kilitli</h4>
                <p className="text-sm text-yellow-500/70">Aboneliğinizi yükselterek kilidi açın.</p>
              </div>
            </div>
            <Link href="/pricing" className="px-4 py-2 rounded-lg bg-yellow-500 text-black font-bold text-sm hover:bg-yellow-400 transition-colors">
              Yükselt
            </Link>
          </div>
        )}

        {/* ADMIN MODERATION PANEL */}
        {user.email === 'vkesgin38@gmail.com' && <AdminModerationPanel />}
      </div>
    </main>
  );
}

function AdminModerationPanel() {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchComments = async () => {
    const token = localStorage.getItem("ui_token");
    try {
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/admin/comments", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      setComments(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, []);

  const handleApprove = async (id: number) => {
    const token = localStorage.getItem("ui_token");
    try {
      await fetch(`https://vk-portfolio-api.vkesgin38.workers.dev/api/admin/comments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 1 })
      });
      fetchComments();
    } catch (e) {}
  };

  const handleReject = async (id: number) => {
    const token = localStorage.getItem("ui_token");
    try {
      await fetch(`https://vk-portfolio-api.vkesgin38.workers.dev/api/admin/comments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 2 })
      });
      fetchComments();
    } catch (e) {}
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Bu yorumu silmek istediğine emin misin?')) return;
    const token = localStorage.getItem("ui_token");
    try {
      await fetch(`https://vk-portfolio-api.vkesgin38.workers.dev/api/admin/comments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchComments();
    } catch (e) {}
  };

  return (
    <div className="mt-12 p-8 rounded-3xl border border-blue-500/30 bg-blue-500/5">
      <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
        Yorum Moderasyon Paneli (Sadece Sen Görüyorsun)
      </h3>
      
      {loading ? (
        <p className="text-white/40">Yükleniyor...</p>
      ) : comments.length === 0 ? (
        <p className="text-white/40 italic">Onay bekleyen veya mevcut yorum bulunmuyor.</p>
      ) : (
        <div className="space-y-4">
          {comments.map((c: any) => (
            <div key={c.id} className={`p-4 rounded-xl border flex flex-col md:flex-row justify-between gap-4 ${c.is_approved === 1 ? 'border-white/5 bg-white/[0.02]' : c.is_approved === 2 ? 'border-red-500/20 bg-red-500/10' : 'border-blue-500/20 bg-blue-500/10'}`}>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-bold text-sm text-white">{c.full_name}</span>
                  <span className="text-xs text-white/40">({c.email})</span>
                  {c.is_approved === 0 && (
                    <span className="px-2 py-0.5 rounded bg-blue-500 text-[10px] font-bold text-white uppercase">ONAY BEKLİYOR</span>
                  )}
                  {c.is_approved === 1 && (
                    <span className="px-2 py-0.5 rounded bg-green-500/20 text-[10px] font-bold text-green-500 uppercase border border-green-500/30">YAYINDA</span>
                  )}
                  {c.is_approved === 2 && (
                    <span className="px-2 py-0.5 rounded bg-red-500/20 text-[10px] font-bold text-red-500 uppercase border border-red-500/30">REDDEDİLDİ</span>
                  )}
                </div>
                <p className={`text-sm italic mb-2 ${c.is_approved === 2 ? 'text-red-400/60 line-through' : 'text-white/70'}`}>"{c.content}"</p>
                <div className="text-[10px] text-white/30">
                  Bileşen ID: {c.component_id} • {new Date(c.created_at).toLocaleString('tr-TR')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {c.is_approved !== 1 && (
                  <button
                    onClick={() => handleApprove(c.id)}
                    className="px-4 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/40 text-green-400 text-xs font-bold transition-colors border border-green-500/30"
                  >
                    Onayla
                  </button>
                )}
                {c.is_approved !== 2 && (
                  <button
                    onClick={() => handleReject(c.id)}
                    className="px-4 py-2 rounded-lg bg-orange-500/20 hover:bg-orange-500/40 text-orange-400 text-xs font-bold transition-colors border border-orange-500/30"
                  >
                    Reddet
                  </button>
                )}
                <button
                  onClick={() => handleDelete(c.id)}
                  className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/40 text-red-400 text-xs font-bold transition-colors border border-red-500/30"
                >
                  Kalıcı Sil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
