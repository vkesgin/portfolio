// fixtures.js: canned data for SB_FAKE_AI='1' and tests (no model, no network).
// FAKE_DRAFT_V6: the real e2e run1 gemma draft (prototype), converted to v6 by finalizeDraft(). FAKE_JPEG_B64: 160x90 grayscale JPEG.
export const FAKE_IDEA = "Sayın Gayrimenkul için STM'nin sokaklarında fil dolaşacak, dükkan aralarının büyüklüğünü göstermek için";
export const FAKE_DRAFT_V6 = {
 "title": "STM Ferahlık Gösterisi",
 "logline": "STM projesinin geniş sokakları, devasa bir filin bile rahatça dolaşabileceği kadar ferah bir yapı sunuyor.",
 "core_message": "STM'nin geniş sokakları, en büyük canlılar için bile yeterince ferah.",
 "interpretations": [
  {
   "name": "STM",
   "meaning": "Sayın Gayrimenkul tarafından geliştirilen ticari bir proje veya dükkanlar sokağı.",
   "confidence": "medium"
  },
  {
   "name": "Fil",
   "meaning": "Sokakların genişliğini ve ferahlığını vurgulamak için kullanılan gerçeküstü bir ölçek aracı.",
   "confidence": "high"
  },
  {
   "name": "STM",
   "meaning": "Açılımı belirtilmemiş; aynı harfleri kullanan başka bir kurum, proje ya da yer adı da olabilir. Müşteriyle doğrulanmalı.",
   "confidence": "low"
  }
 ],
 "assumptions": [
  "STM, modern mimariye sahip, geniş yürüme yolları ve dükkan cepheleri olan bir ticari komplekstir.",
  "Fil, gerçekçi bir görünüme sahip ancak sahnenin absürtlüğü için bir metafor olarak kullanılmıştır.",
  "Mekan, dükkanların karşılıklı dizildiği geniş bir cadde formundadır."
 ],
 "anchor_prompt_en": "Wide, eye-level view of a modern commercial street with contemporary shop facades on both sides. THE ELEPHANT is standing in the center of the wide paved walkway, facing the camera in a neutral pose. No text.",
 "aspect_ratio": "16:9",
 "scenes": [
  {
   "n": 1,
   "title": "Giriş",
   "duration_s": 4,
   "shot": "wide",
   "camera_move": "pan",
   "action": "Geniş ve modern bir dükkanlar sokağının ortasından devasa bir fil ağır adımlarla kadraja girer.",
   "onscreen_text": "",
   "vo": "Bazı genişlikler sadece bakarak anlaşılmaz.",
   "sound": "Derinden gelen ağır ayak sesleri, hafif ve merak uyandırıcı bir müzik.",
   "image_prompt_en": "Wide shot, 24mm lens. THE ELEPHANT enters the frame from the left, walking onto a wide, paved commercial street. The modern shop facades line the sides of the street under a bright sky. The elephant's massive scale is immediately apparent against the architecture.",
   "characters": [
    "THE ELEPHANT"
   ]
  },
  {
   "n": 2,
   "title": "Ölçek Vurgusu",
   "duration_s": 5,
   "shot": "medium",
   "camera_move": "tracking",
   "action": "Kamera filin yanından yürüyüşünü takip eder; fil, dükkanların arasındaki geniş boşlukta rahatça ilerlemektedir.",
   "onscreen_text": "",
   "vo": "Gerçek ferahlığı hissetmek gerekir.",
   "sound": "Ayak seslerinin ritmik ve tok yankısı, hafif rüzgar sesi.",
   "image_prompt_en": "Medium shot, side profile. THE ELEPHANT walks steadily through the center of the street. On both sides, the modern shop entrances and large glass windows are visible. There is significant clearance between the elephant and the buildings.",
   "characters": [
    "THE ELEPHANT"
   ]
  },
  {
   "n": 3,
   "title": "Genişlik Kanıtı",
   "duration_s": 6,
   "shot": "aerial_drone",
   "camera_move": "crane_up",
   "action": "Kamera yükselerek yukarıdan bakış sağlar; fil, dükkanlar arasındaki devasa koridorun ortasında küçük bir nokta gibi değil, rahatça sığan bir figür olarak görünür.",
   "onscreen_text": "",
   "vo": "STM'nin geniş sokaklarıyla her şey yerli yerinde.",
   "sound": "Müzik yükselir, daha epik ve güven verici bir tona geçer.",
   "image_prompt_en": "Aerial drone shot, high angle looking down. THE ELEPHANT is walking down the long, wide avenue of the commercial complex. The street is exceptionally wide, with shops organized in neat rows on either side, showing the immense scale of the walkways.",
   "characters": [
    "THE ELEPHANT"
   ]
  },
  {
   "n": 4,
   "title": "Yakın Plan Ölçek",
   "duration_s": 4,
   "shot": "close_up",
   "camera_move": "static",
   "action": "Filin devasa ayağı, bir dükkanın giriş kapısının hemen yanındaki geniş kaldırıma basar; aradaki mesafe çok belirgindir.",
   "onscreen_text": "",
   "vo": "Sayın Gayrimenkul güvencesiyle.",
   "sound": "Güçlü bir ayak sesi ve ardından gelen yumuşak bir bitiş müziği.",
   "image_prompt_en": "Close-up shot, low angle. THE ELEPHANT's massive, wrinkled foot steps onto the pavement in the foreground. In the midground, a shop entrance is clearly visible, showing a large, comfortable distance between the foot and the building facade.",
   "characters": [
    "THE ELEPHANT"
   ]
  },
  {
   "n": 5,
   "title": "Logo/Kapanış",
   "duration_s": 3,
   "shot": "medium",
   "camera_move": "static",
   "action": "Modern bir dükkanın üzerindeki boş tabela panosu görünür.",
   "onscreen_text": "SAYIN GAYRİMENKUL",
   "vo": "",
   "sound": "Marka jingle'ı.",
   "image_prompt_en": "Medium shot of a modern, blank shop fascia on a clean building wall. No text or logos on the sign.",
   "characters": []
  }
 ],
 "location_en": "The LOCATION is a modern commercial street with clean-lined, contemporary shop facades, wide paved walkways, and a clear, open sky. The setting is an orderly, upscale outdoor shopping district.",
 "characters_en": [
  {
   "name": "THE ELEPHANT",
   "name_tr": "fil",
   "look": "a massive, majestic African elephant with detailed skin texture"
  }
 ]
};
export const FAKE_TAVILY = [
  { query: "Sayın Gayrimenkul", results: [
    { title: "Sayın Gayrimenkul | Projeler", url: "https://sayingayrimenkul.com/", content: "Sky Garden, Orga Konutları, Life Point Residence.", score: 0.81 } ] },
  { query: "Sayın Gayrimenkul STM", results: [
    { title: "STM - Sayın Gayrimenkul", url: "https://sayingayrimenkul.com/stm", content: "STM Broşür. STM Katalog. Dükkân blokları.", score: 0.77 } ] },
  { query: "STM", results: [
    { title: "STM Savunma Teknolojileri Mühendislik ve Ticaret A.Ş.", url: "https://www.stm.com.tr/tr", content: "STM (Savunma Teknolojileri Mühendislik) Ankara.", score: 0.9 },
    { title: "Sınır Ticaret Merkezi (STM) Nedir?", url: "https://www.muhasebenews.com/sinir-ticareti-merkezi-stm-nedir/", content: "Sınır ticaret merkezleri.", score: 0.55 } ] },
];
export const FAKE_JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//wAALCABaAKABAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APSKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKqPdTO7JZW4m2EhpHk2JkdQCASSPpjqM5GKb9ruIfmvrZI4u8sUu9U92yFIHuAe5OAM1dooooooooooooooooqpqjsliwRihkdItynBUO4UkHsQDx71ZRFjRUjUKigBVUYAHoKdVLTfkN1bL/AKu3n2R+ylVfH0G4gegAFXaKKKKKKKKKKKKKKo3k139vt7W0kgj8yKSRmliL/dKAAAMv9/8ASoriz1O4hMb31mBkMCto2VIIII/ediAeeKZby6pK5gkvbCO5UZaI2rE4/vD95yvv+BwcgLcS6jb7Ve/sjI+fLiW0bfIfQDzf16DqcCltrTVold2vLLzZm8yT/RXPzYAwD5g4AAA4HA55zUkMt9HqcVtdTW8qSwySAxwshBVkHdmz9/8AStCiiiiiiiiiiiiiqM3/ACHrT/r1n/8AQoquswVSzEBQMknoKqXFvFqSBJo0e2ByNyg7z6jPQcnkcntgdUhs4dPZ3tLeJInOXWOMBvrx1A9Pc47CrisGUMpBUjII6GqU3/IetP8Ar1n/APQoqvUUUUUUUUUUUUUVn3LrHrdqznAFrP8A+hxVaVHlYNOoVVOVjznn1Pv7dB78YmoqFojExkgUZJy6DgP7/wC979+/YioZBJrloQCCLacMp6qd0XBrRooooooooooooqOWVY8AhmZvuqoyT/n1PHNUGjP9v2jzEM/2acgdk+aLp+Z57/oNOiiis26jLa9aNG/lv9lm+YKDnDRYB9ufarscwdvLbCygZKZ5+o9R7/14qWiiiiiqv2+H+5c/+A0n/wATR9vh/uXP/gNJ/wDE0fb4f7lz/wCA0n/xNH2+H+5c/wDgNJ/8TR9vh/uXP/gNJ/8AE0yTUY8FYknL8dbeT5Qc8kYzjg/55oiuoUyzLctI33m+yyc+w+Xge3/1zVS8uZft9vdWkDSeXFJGyyxyp94oQQRG39z9aP7U1D/oHx/99T//ABmj+1NQ/wCgfH/31P8A/GaP7U1D/oHx/wDfU/8A8Zo/tTUP+gfH/wB9T/8Axmmw3VxJqcVzdWxiSKGSMCNJnJLMh7xrj7n61eku7eRcFLoEHKsLaTKn1Hy02PUUHyzxzKc4UiCTD9eg25zweOfqak+3w/3Ln/wGk/8AiaPt8P8Acuf/AAGk/wDiaPt8P9y5/wDAaT/4mj7fD/cuf/AaT/4mj7fD/cuf/AaT/wCJq1RRRULSPIxjhBABw0vGB6gep/T8sU+OJIl2xqFBOT6k+p9T70+iiiiiiimuiyIVcZBqLebf5ZSxi/hfk7fZv8fz9TPRRRRRSMwVSzEBQMknoKhy1zyjskP95er/AEPYe/U9sd5lUKoVQAoGAB0FLRRRRRRRRRRUG17flPmhH8AHK/T1Ht+XYVMrBlDKQVIyCOhpaKKKgueZbZT0MvI9cKxH6gH8KnoooooooooooooqvEoS+nVAFUojEDgEktk/XgVYor//2Q==";
