export const siteConfig = {
  name: 'WalkTogether',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  apiInternalUrl: process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  clubAdminUrl: process.env.NEXT_PUBLIC_CLUB_ADMIN_URL ?? 'http://localhost:3001',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'hello@walktogether.app',
  description:
    'WalkTogether brings walkers, runners and fitness clubs together: GPS tracking, club management, events, challenges and community, built for Kenya and beyond.',
};
