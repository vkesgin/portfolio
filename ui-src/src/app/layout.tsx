import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s | Veli Kesgin UI - Rive & React Animations",
    default: "Rive Component Library | Interactive UI Assets | Veli Kesgin UI",
  },
  description: "Modern, interactive and ready-to-use Rive animation components for React, Next.js, Webflow, WordPress and Flutter. En zengin hazır Rive UI animasyon kütüphanesi.",
  keywords: [
    "rive animation", "rive animasyon", "ready animations", "hazır animasyon", 
    "rive ui components", "react rive", "interactive buttons", "nextjs animations", 
    "webflow rive", "flutter rive", "ui rive", "veli kesgin", "3d animations", 
    "state machine animations", "animated ui library"
  ],
  authors: [{ name: "Veli Kesgin", url: "https://velikesgin.com" }],
  creator: "Veli Kesgin",
  publisher: "Veli Kesgin",
  formatDetection: { email: false, address: false, telephone: false },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    url: "https://velikesgin.com/ui",
    title: "Veli Kesgin UI - Premium Rive Animations Library",
    description: "Modern web projeleri için hazır, etkileşimli Rive animasyonları. React, Next.js, Webflow, Flutter ve fazlası için interaktif UI bileşenleri.",
    siteName: "Veli Kesgin UI",
    images: [{
      url: "https://velikesgin.com/files/rive-ui-og.jpg", // placeholder, if needed later
      width: 1200,
      height: 630,
      alt: "Veli Kesgin UI - Rive Components"
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Veli Kesgin UI - Premium Rive Animations Library",
    description: "Modern web projeleri için hazır, etkileşimli Rive animasyonları. React, Next.js, Webflow, Flutter ve fazlası için interaktif UI bileşenleri.",
    creator: "@vkesgin",
  },
  alternates: {
    canonical: "https://velikesgin.com/ui",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Veli Kesgin UI Rive Component Library",
  "operatingSystem": "Web, React, Next.js, Webflow, Flutter",
  "applicationCategory": "DeveloperApplication",
  "description": "Premium, interactive and ready-to-use Rive animation components for modern web and mobile applications.",
  "offers": {
    "@type": "Offer",
    "price": "15.00",
    "priceCurrency": "USD",
  },
  "author": {
    "@type": "Person",
    "name": "Veli Kesgin",
    "url": "https://velikesgin.com"
  },
  "url": "https://velikesgin.com/ui"
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${inter.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-black text-white">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Navbar />
        {children}
      </body>
    </html>
  );
}
