import type { MetadataRoute } from 'next';
import { fetchClubs } from '@/lib/api';
import { siteConfig } from '@/lib/config';

export const revalidate = 3600;

const staticPaths = ['', '/features', '/clubs', '/for-clubs', '/for-organizations', '/sponsors', '/pricing', '/about', '/contact', '/privacy', '/terms'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = staticPaths.map((p) => ({ url: `${siteConfig.url}${p}`, changeFrequency: 'weekly', priority: p === '' ? 1 : 0.7 }));
  // Only PUBLIC clubs are indexable. Pages are capped to keep the sitemap bounded; use sitemap index files when this grows.
  try {
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await fetchClubs({ cursor });
      for (const c of page.items) if (c.visibility === 'PUBLIC') entries.push({ url: `${siteConfig.url}/clubs/${c.slug}`, changeFrequency: 'daily', priority: 0.6 });
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  } catch {
    // The static entries are still useful if the API is temporarily unavailable.
  }
  return entries;
}
