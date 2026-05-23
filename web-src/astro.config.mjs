import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://velikesgin.com',
  integrations: [sitemap({
    i18n: {
      defaultLocale: 'tr',
      locales: {
        en: 'en-US',
        tr: 'tr-TR'
      }
    }
  })],
  i18n: {
    defaultLocale: 'tr',
    locales: ['tr', 'en'],
    routing: {
      prefixDefaultLocale: false
    }
  }
});
