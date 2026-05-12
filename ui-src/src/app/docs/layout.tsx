import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rive Dosyası Nasıl Çalıştırılır? | Entegrasyon Kılavuzu & Ücretsiz Şablonlar",
  description: "Framer, Wix Studio, React, Webflow, WordPress ve daha fazlası için Rive (.riv) animasyon entegrasyon kılavuzu. Hazır UI bileşenleri, ücretsiz ve PRO şablonlar, ticari kullanıma uygun etkileşimli web animasyonları.",
  keywords: [
    "rive dosyası nasıl çalıştırılır",
    "rive animasyon",
    "hazır web animasyonları",
    "framer rive entegrasyonu",
    "wix studio rive",
    "ücretsiz rive şablonları",
    "ücretli rive paketleri",
    "ui bileşenleri",
    "ticari kullanıma uygun animasyon",
    "react rive animation",
    "webflow rive",
    "wordpress rive yükleme",
    ".riv dosyası açma"
  ],
  openGraph: {
    title: "Rive Animasyon Entegrasyon Kılavuzu - VK UI",
    description: "Framer, Wix Studio, React, Webflow ve daha fazlası için Rive (.riv) animasyon entegrasyon kılavuzu. Hazır web animasyonları ve ticari kullanıma uygun şablonlar.",
    type: "article",
    url: "https://velikesgin.com/ui/docs",
  },
  alternates: {
    canonical: "https://velikesgin.com/ui/docs",
  }
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Schema.org for AI & Google Search visibility */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "headline": "Rive Dosyası Nasıl Çalıştırılır? Entegrasyon Kılavuzu",
            "description": "Framer, Wix Studio, React, Webflow ve WordPress için Rive (.riv) dosyalarını çalıştırma rehberi. Hazır web animasyonları, ücretsiz ve PRO şablonlar.",
            "author": {
              "@type": "Person",
              "name": "Veli Kesgin"
            },
            "publisher": {
              "@type": "Organization",
              "name": "VK UI Library",
              "logo": {
                "@type": "ImageObject",
                "url": "https://velikesgin.com/ui/icon.png"
              }
            },
            "about": [
              {
                "@type": "Thing",
                "name": "Rive Animation"
              },
              {
                "@type": "Thing",
                "name": "Web Design"
              },
              {
                "@type": "Thing",
                "name": "UI Components"
              }
            ],
            "offers": {
              "@type": "AggregateOffer",
              "priceCurrency": "USD",
              "lowPrice": "0",
              "highPrice": "12",
              "offerCount": "2",
              "offers": [
                {
                  "@type": "Offer",
                  "name": "Ücretsiz Üyelik",
                  "price": "0",
                  "priceCurrency": "USD",
                  "description": "Ücretsiz bileşenlerin orijinal .riv dosyalarını indirme ve aylık 5 indirme hakkı."
                },
                {
                  "@type": "Offer",
                  "name": "PRO Paket",
                  "price": "12",
                  "priceCurrency": "USD",
                  "description": "Tüm UI bileşenlerine sınırsız erişim, hazır web şablonları, .riv dosyalarını indirme ve ticari kullanım lisansı."
                }
              ]
            }
          })
        }}
      />
      {children}
    </>
  );
}
