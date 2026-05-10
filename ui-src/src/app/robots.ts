import { MetadataRoute } from 'next'

export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/ui/', '/ui/docs', '/ui/pricing', '/ui/templates'],
      disallow: ['/ui/dashboard', '/ui/test'],
    },
    sitemap: 'https://velikesgin.com/ui/sitemap.xml',
  }
}
