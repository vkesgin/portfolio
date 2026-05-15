"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (password !== confirmPassword) {
      setError("Şifreler birbiriyle eşleşmiyor.");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("https://vk-portfolio-api.vkesgin38.workers.dev/api/ui/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Kayıt başarısız");
      }

      if (data.needsVerification) {
        router.push(`/verify-email?email=${encodeURIComponent(data.email)}`);
      } else {
        localStorage.setItem("ui_token", data.token);
        router.push("/dashboard");
      }
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
        
        <h1 className="text-3xl font-bold mb-2 relative z-10 text-center">Hesap Oluştur</h1>
        <p className="text-white/50 mb-8 text-center relative z-10">
          Kütüphaneye erişmek için ücretsiz kayıt olun
        </p>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4 relative z-10">
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Ad Soyad</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-[#ff2b73] transition-colors"
              placeholder="Adınız Soyadınız"
            />
          </div>
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
              minLength={6}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/70 mb-1">Şifreyi Tekrar Girin</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/10 text-white focus:outline-none focus:border-[#ff2b73] transition-colors"
              placeholder="••••••••"
              minLength={6}
            />
          </div>
          
          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 mt-4 rounded-xl bg-[#ff2b73] hover:bg-[#ff2b73]/90 text-white font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Kayıt Olunuyor..." : "Kayıt Ol"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/50 relative z-10">
          Zaten hesabınız var mı?{" "}
          <Link href="/login" className="text-[#ff2b73] hover:underline font-medium">
            Giriş Yap
          </Link>
        </p>
      </div>
    </main>
  );
}
