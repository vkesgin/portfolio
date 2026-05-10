"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Giriş başarısız");
      }

      localStorage.setItem("ui_token", data.token);
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#ff2b73]/20 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/20 blur-3xl rounded-full -translate-x-1/2 translate-y-1/2"></div>
        
        <h1 className="text-3xl font-bold mb-2 relative z-10 text-center">Hoş Geldiniz</h1>
        <p className="text-white/50 mb-8 text-center relative z-10">
          Kütüphaneye erişmek için giriş yapın
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4 relative z-10">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">E-posta</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-[#ff2b73] transition-colors"
              placeholder="ornek@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Şifre</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-[#ff2b73] transition-colors"
              placeholder="••••••••"
            />
            <div className="flex justify-end mt-2">
              <Link href="/forgot-password" className="text-xs text-white/40 hover:text-[#ff2b73] transition-colors">
                Şifremi Unuttum
              </Link>
            </div>
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 mt-4 rounded-xl bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Giriş Yapılıyor..." : "Giriş Yap"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/50 relative z-10">
          Hesabınız yok mu?{" "}
          <Link href="/register" className="text-[#ff2b73] hover:underline font-medium">
            Kayıt Ol
          </Link>
        </p>
      </div>
    </main>
  );
}
