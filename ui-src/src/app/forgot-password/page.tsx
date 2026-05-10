import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white/5 border border-white/10 p-8 rounded-3xl relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#ff2b73]/20 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-500/20 blur-3xl rounded-full -translate-x-1/2 translate-y-1/2"></div>
        
        <div className="relative z-10 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff2b73" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          
          <h1 className="text-2xl font-bold mb-4">Şifremi Unuttum</h1>
          
          <p className="text-white/60 mb-6 text-sm leading-relaxed">
            Güvenliğiniz için otomatik şifre sıfırlama devre dışı bırakılmıştır. Hesabınızı güvence altına almak ve yeni şifrenizi belirlemek için lütfen sistem yöneticisi ile iletişime geçin.
          </p>

          <div className="bg-black/40 border border-white/5 rounded-xl p-4 w-full mb-8">
            <p className="text-sm font-medium text-white/80 mb-2">Destek İletişim:</p>
            <a href="mailto:vkesgin37@gmail.com" className="text-[#ff2b73] hover:underline font-bold text-lg flex items-center justify-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
              vkesgin37@gmail.com
            </a>
          </div>

          <Link href="/login" className="w-full py-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold transition-all flex items-center justify-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            Giriş Sayfasına Dön
          </Link>
        </div>
      </div>
    </main>
  );
}
