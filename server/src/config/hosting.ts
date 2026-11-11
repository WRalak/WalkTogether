/**
 * Split-hosting helpers. The platform admin web app is deployed separately from the API. Its sign-in
 * relies on a SameSite=Strict, httpOnly refresh cookie set by the API, which browsers only send when
 * the web app and the API are on the same *site* (same registrable domain),
 * e.g. admin.walktogether.app → api.walktogether.app. Platform default domains such as *.vercel.app
 * and *.onrender.com are different sites, so sign-in from them silently fails.
 */

/** Approximate registrable domain ("eTLD+1"); handles country second-level domains such as .co.ke. */
export function registrableDomain(hostname: string) {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const tld = labels.at(-1)!;
  const second = labels.at(-2)!;
  const take = tld.length === 2 && second.length <= 3 ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Configured browser origins that are NOT same-site with the API (their web sign-in will not work). */
export function crossSiteOrigins(apiPublicUrl: string, origins: string[]) {
  const apiSite = registrableDomain(new URL(apiPublicUrl).hostname);
  return origins.filter((o) => {
    try {
      return registrableDomain(new URL(o).hostname) !== apiSite;
    } catch {
      return true;
    }
  });
}
