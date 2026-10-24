/**
 * Status-aware logo proxy behind `companyLogoUrl` (`/logos/<domain>.png`).
 *
 * The favicon is fetched server-side from ONE fixed upstream host, so the
 * visitor's IP and viewing history never reach it and the path can't be
 * pointed at an arbitrary host (the domain is validated as a hostname and
 * only ever lands in a query value). Upstream's 404 for a missing favicon is
 * passed through as 404 so `CompanyLogo`'s `onError` fires.
 */

const UPSTREAM = "https://www.google.com/s2/favicons";
const UPSTREAM_TIMEOUT_MS = 5_000;
const LOGO_SUFFIX = ".png";
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const CACHE_FOUND = "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800";
const CACHE_MISSING = "public, max-age=3600, s-maxage=86400";

/** Pure: the hostname a `<domain>.png` route segment names, or null if it is not a valid hostname. */
export function domainFromLogoFile(file: string): string | null {
  if (!file.endsWith(LOGO_SUFFIX)) return null;
  let domain: string;
  try {
    domain = decodeURIComponent(file.slice(0, -LOGO_SUFFIX.length)).toLowerCase();
  } catch {
    return null;
  }
  return HOSTNAME.test(domain) ? domain : null;
}

/** Fetches the logo for a route segment and shapes the response; `fetchImpl` is the injectable I/O seam. */
export async function proxyLogo(file: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const domain = domainFromLogoFile(file);
  if (!domain) return new Response("invalid domain", { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${UPSTREAM}?domain=${encodeURIComponent(domain)}&sz=128`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return new Response("logo upstream unreachable", { status: 502 });
  }

  if (upstream.status === 404) {
    return new Response(null, { status: 404, headers: { "Cache-Control": CACHE_MISSING } });
  }
  if (upstream.status !== 200) return new Response("logo upstream error", { status: 502 });

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control": CACHE_FOUND,
    },
  });
}
