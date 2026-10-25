/**
 * A posting URL -> the employer's board root on its ATS, or null.
 * Ported from subspace `deriveBoardUrl` (src/lib/hiringcafe-ats-inference.ts:104; greenhouse, lever,
 * ashby, smartrecruiters, workable, bamboohr, teamtailor) plus Workday and iCIMS
 * (tenant hosts per subspace src/lib/ats-tenant-slug.ts RULES).
 * Unlike the original, an unrecognised host is null: one posting is never a careers link.
 */
const NOT_A_TENANT = new Set(["embed", "api", "v1", "jobs", "oneclick-ui", "www"]);
const WORKDAY_LOCALE = /^[a-z]{2}(?:-[a-z]{2})?$/i;

const firstSegment = (path: string): string | null => {
  const seg = path.split("/").filter(Boolean)[0]?.toLowerCase();
  return seg && !NOT_A_TENANT.has(seg) ? seg : null;
};

/** Host-per-tenant boards: the tenant is the subdomain, the board root a fixed path. */
const SUBDOMAIN_TENANT: Array<[RegExp, string]> = [
  [/^([a-z0-9-]+)\.bamboohr\.com$/, "/careers"],
  [/^([a-z0-9-]+)\.teamtailor\.com$/, "/jobs"],
  [/^(?:careers-)?([a-z0-9-]+)\.icims\.com$/, "/jobs"],
];
/** Path-per-tenant boards: the tenant is the first path segment. */
const PATH_TENANT: Array<[RegExp, string]> = [
  [/^(?:boards|job-boards)(?:\.[a-z]{2,3})?\.greenhouse\.io$/, ""],
  [/^jobs\.lever\.co$/, ""],
  [/^jobs\.ashbyhq\.com$/, ""],
  [/^jobs\.smartrecruiters\.com$/, ""],
  [/^apply\.workable\.com$/, ""],
];

export function deriveBoardRoot(postingUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(postingUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();

  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(host)) {
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs[0] && WORKDAY_LOCALE.test(segs[0])) segs.shift();
    return segs[0] ? `https://${host}/${segs[0]}` : null;
  }
  for (const [re, root] of SUBDOMAIN_TENANT) {
    const tenant = host.match(re)?.[1];
    if (tenant && !NOT_A_TENANT.has(tenant)) return `https://${host}${root}`;
  }
  for (const [re] of PATH_TENANT) {
    if (!re.test(host)) continue;
    const slug = firstSegment(u.pathname);
    return slug ? `https://${host}/${slug}` : null;
  }
  return null;
}
