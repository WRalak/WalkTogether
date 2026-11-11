/** @type {import('next').NextConfig} */
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      `connect-src 'self' ${apiOrigin}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  poweredByHeader: false,
  transpilePackages: ['@walktogether/api-client', '@walktogether/shared-types', '@walktogether/validation', '@walktogether/shared-utils'],
  // Pre-restructure URLs map onto /dashboard/<section>.
  // Older URLs map onto the current /dashboard/<section> structure.
  async redirects() {
    const moved = { revenue: 'analytics', billing: 'subscriptions', sponsorships: 'sponsorships', sponsors: 'sponsorships', campaigns: 'sponsorships', challenges: 'sponsorships/competitions' };
    const same = ['users', 'clubs', 'moderation', 'audit-logs', 'security', 'system', 'settings', 'admins'];
    return [
      ...Object.entries(moved).flatMap(([from, to]) => [
        { source: `/${from}`, destination: `/dashboard/${to}`, permanent: true },
        ...(from === to ? [] : [{ source: `/dashboard/${from}`, destination: `/dashboard/${to}`, permanent: true }]),
      ]),
      ...same.map((s) => ({ source: `/${s}/:path*`, destination: `/dashboard/${s}/:path*`, permanent: true })),
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: [...securityHeaders, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};

export default nextConfig;
