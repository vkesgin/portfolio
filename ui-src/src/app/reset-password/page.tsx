"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Şifre sıfırlama başarısız");
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center relative z-10">
        <div className="w-16 h-16 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">Şifre Başarıyla Sıfırlandı!</h2>
        <p className="text-white/60">Giriş sayfasına yönlendiriliyorsunuz...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleReset} className="space-y-4 relative z-10">
      <h1 className="text-2xl font-bold mb-2 text-center">Yeni Şifre Belirle</h1>
      <p className="text-white/50 mb-6 text-center text-sm">
        E-postanıza gönderilen 6 haneli kodu ve yeni şifrenizi girin.
      </p>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">E-posta</label>
        <input
          type="email"
          disabled
          value={email}
          className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-white/50 cursor-not-allowed"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">Doğrulama Kodu</label>
        <input
          type="text"
          required
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-[#ff2b73] transition-colors font-mono tracking-widest"
          placeholder="••••••"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">Yeni Şifre</label>
        <input
          type="password"
          required
          minLength={6}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-[#ff2b73] transition-colors"
          placeholder="••••••••"
        />
      </div>
      
      <button
        type="submit"
        disabled={loading || code.length < 5 || newPassword.length < 6}
        className="w-full py-4 mt-4 rounded-xl bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Sıfırlanıyor..." : "Şifreyi Güncelle"}
      </button>

      <p className="mt-6 text-center text-sm text-white/50">
        <Link href="/login" className="text-white hover:underline font-medium">
          Giriş Sayfasına Dön
        </Link>
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#ff2b73]/20 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/20 blur-3xl rounded-full -translate-x-1/2 translate-y-1/2"></div>
        
        <Suspense fallback={<div className="text-center">Yükleniyor...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
