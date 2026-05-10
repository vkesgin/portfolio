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
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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
                <Link href="/" className="inline-block px-6 py-3 rounded-xl bg-white text-black hover:bg-white/90 font-bold transition-all text-sm">
                  Bileşenleri Keşfet
                </Link>
              </div>
            )}
          </div>

          {/* User Details Card */}
          <div className="p-8 rounded-3xl border border-white/10 bg-white/5 flex flex-col justify-center">
            <h3 className="text-sm font-medium text-white/50 mb-4">Hesap Bilgileri</h3>
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
      </div>
    </main>
  );
}
