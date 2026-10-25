import { nameAgreeingWithDomain } from "@/lib/companies/company-name";

/**
 * A posting URL -> the employer's board root on its ATS, or null.
 * Ported from subspace `deriveBoardUrl` (src/lib/hiringcafe-ats-inference.ts:104; greenhouse, lever,
 * ashby, smartrecruiters, workable, bamboohr, teamtailor) plus Workday and iCIMS
 * (tenant hosts per subspace src/lib/ats-tenant-slug.ts RULES).
 * Unlike the original, an unrecognised host is null: one posting is never a careers link.
 */
const NOT_A_TENANT = new Set(["embed", "api", "v1", "j", "jobs", "oneclick-ui", "www"]);
const WORKDAY_HOST = /^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/;
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

export interface BoardRoot { root: string; tenant: string }

export function deriveBoardRoot(postingUrl: string): BoardRoot | null {
  let u: URL;
  try {
    u = new URL(postingUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();

  if (WORKDAY_HOST.test(host)) {
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs[0] && WORKDAY_LOCALE.test(segs[0])) segs.shift();
    return segs[0] ? { root: `https://${host}/${segs[0]}`, tenant: host.split(".")[0]! } : null;
  }
  for (const [re, root] of SUBDOMAIN_TENANT) {
    const tenant = host.match(re)?.[1];
    if (tenant && !NOT_A_TENANT.has(tenant)) return { root: `https://${host}${root}`, tenant };
  }
  for (const [re] of PATH_TENANT) {
    if (!re.test(host)) continue;
    const slug = firstSegment(u.pathname);
    return slug ? { root: `https://${host}/${slug}`, tenant: slug } : null;
  }
  return null;
}

/**
 * The board root most of the domain's recent postings agree on (ties go to the newest, `postingUrls` newest first).
 * A root counts only when its tenant names this employer, by the repo's name/domain agreement
 * (`nameAgreeingWithDomain`): another employer's tenant (atdstl.org on wustl.wd1.myworkdayjobs.com) is no evidence.
 */
export function pickBoardRoot(postingUrls: readonly string[], domain: string): string | null {
  const votes = new Map<string, number>();
  for (const url of postingUrls) {
    const board = deriveBoardRoot(url);
    if (board && nameAgreeingWithDomain(board.tenant.replace(/[-_.]+/g, " "), domain)) votes.set(board.root, (votes.get(board.root) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [root, n] of votes) if (best === null || n > votes.get(best)!) best = root; // Map keeps first-seen (newest) order, so strict > keeps the newest on a tie
  return best;
}

/** A URL on an ATS vendor host this module knows, from which no tenant can be read (the vendor's own search or home
 *  page): it names no company, so it is not this employer's careers page. */
export function isTenantlessVendorUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const known = WORKDAY_HOST.test(host) || [...SUBDOMAIN_TENANT, ...PATH_TENANT].some(([re]) => re.test(host));
  return known && deriveBoardRoot(url) === null;
}
