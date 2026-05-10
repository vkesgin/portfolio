"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "";
  
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Doğrulama başarısız");
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
        <h2 className="text-2xl font-bold mb-2">E-posta Doğrulandı!</h2>
        <p className="text-white/60">Giriş sayfasına yönlendiriliyorsunuz...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4 relative z-10">
      <h1 className="text-2xl font-bold mb-2 text-center">E-posta Doğrulama</h1>
      <p className="text-white/50 mb-6 text-center text-sm">
        <strong className="text-white">{email}</strong> adresine gönderdiğimiz 6 haneli doğrulama kodunu girin.
      </p>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-white/70 mb-1">Doğrulama Kodu</label>
        <input
          type="text"
          required
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-[#ff2b73] transition-colors text-center tracking-[0.5em] font-mono text-lg"
          placeholder="••••••"
        />
      </div>
      
      <button
        type="submit"
        disabled={loading || code.length < 5}
        className="w-full py-4 mt-4 rounded-xl bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Doğrulanıyor..." : "Hesabı Onayla"}
      </button>

      <p className="mt-6 text-center text-sm text-white/50">
        Yanlış e-posta mı girdiniz?{" "}
        <Link href="/register" className="text-[#ff2b73] hover:underline font-medium">
          Başa Dön
        </Link>
      </p>
    </form>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#ff2b73]/20 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/20 blur-3xl rounded-full -translate-x-1/2 translate-y-1/2"></div>
        
        <Suspense fallback={<div className="text-center">Yükleniyor...</div>}>
          <VerifyEmailForm />
        </Suspense>
      </div>
    </main>
  );
}
