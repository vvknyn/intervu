import { FUNCTION_WORDS } from "../geo/common-words";
import { displayCompanyName } from "./presentation";
import type { JobSearchParams } from "./types";

/**
 * Company-name query intent (search-quality wave, 2026-08-11).
 *
 * WHY THIS EXISTS
 * ---------------
 * Meilisearch's `exactness` ranking rule has an ExactAttribute tier: a
 * document whose whole searchable attribute EQUALS the query outranks every
 * document that merely contains it. On this corpus that single rule does two
 * opposite things depending on which attribute it lands on:
 *
 *   - on `title`  — pathological. Bare "Product Manager" rows form a tier
 *     1,073 documents deep (2,238 for "software engineer", 4,037 for
 *     "registered nurse", measured live 2026-08-11), so every SPECIFIC title
 *     ("Product Manager, E-Invoicing" — exactness 0.667) is gated below all
 *     of them and can never reach page 1.
 *   - on `company` — load-bearing. For q="stripe" it is the ONLY thing that
 *     keeps real Stripe listings above "FOREMAN - SEAL & STRIPE" (a title
 *     match, exactness 0.333).
 *
 * Demoting `exactness` in `rankingRules` fixes the first and breaks the
 * second, because Meilisearch applies one global rule order to both query
 * intents and cannot scope a ranking rule per attribute. This module removes
 * that coupling at QUERY time: when the corpus says the typed text IS an
 * employer's name, the search is scoped to `attributesToSearchOn: ["company"]`,
 * which reproduces the company-precision that `exactness` was silently
 * providing — without depending on `exactness` at all. That makes the
 * rankingRules change safe to apply (see scripts/apply-ranking-rules-v2.mjs).
 *
 * WHY A DOMINANCE RATIO AND NOT `probeCompanyMatch`'s BOOLEAN
 * ----------------------------------------------------------
 * `probeCompanyMatch` answers "does ANY company match every word", which is
 * far too loose to gate on — measured live against the company attribute:
 * "accountant" → 91 companies, "software engineer" → 34 ("Software
 * Engineering"), "product manager" → 1 ("IT Product Manager (All Gender)"),
 * and there is an employer literally named "Registered Nurse". Scoping those
 * role searches to `company` would destroy them. What actually separates the
 * two intents is whether the matches are DOMINATED by an employer whose name
 * IS the query: "stripe"/"cloudflare"/"databricks" return 5/5 exact-name
 * matches, every role query above returns 0/5 or 1/4.
 *
 * The gate is therefore a property of the match distribution, never a list of
 * company names — a newly-indexed employer is covered by construction, and
 * nothing here needs editing when the corpus changes.
 *
 * FAILING OPEN IS THE SAFE DIRECTION: a false negative just runs the normal
 * whole-document search (today's behaviour). A false positive would hide
 * legitimate title matches, so both thresholds below are set for precision.
 */

/** How many company-scoped hits to inspect when judging intent. */
export const COMPANY_INTENT_SAMPLE = 10;

/**
 * Minimum number of exactly-named listings required. Guards the degenerate
 * case where the corpus holds ONE junk employer named after a role (e.g. the
 * single company literally called "Registered Nurse"): a 1/1 sample would be
 * a perfect ratio but is not evidence of company intent. An employer with
 * fewer than this many open roles simply keeps the normal search path.
 */
export const COMPANY_INTENT_MIN_EXACT = 3;

/** Minimum share of the sample whose company name IS the query. */
export const COMPANY_INTENT_MIN_RATIO = 0.6;

/**
 * Title-echo veto. The index carries "companies" that are really a job-title
 * fragment the scraper split off ("Storekeeper - Warehouse" arrives with
 * company "Warehouse"), so a role word can pass the dominance gate above:
 * measured live 2026-10-12, "warehouse" 8/10, "mechanic" 10/10, "production"
 * 8/10, "plumber" 6/10 of the top-10 company rows were named exactly that.
 * What tells them apart from a real employer is the row's OWN title: every
 * junk-company row repeats the query in its title (100% of the sample),
 * while an employer's rows rarely do (google 40%, apple 30%, target 20%,
 * deloitte 20%, stripe/shopify/rbc 0-10%). When at least this share of the
 * exact-name rows carry the query in their title, the "company" is a role
 * word and the search stays a normal title search. Evidence, not a list:
 * nothing here names a role or an employer.
 */
export const COMPANY_INTENT_MAX_TITLE_ECHO = 0.5;

/** One company-attribute probe's result — the raw material for the decision. */
export interface CompanyNameSample {
  /** Total documents whose `company` matched every word of the query. */
  total: number;
  /** `company` values from the top of that company-scoped search. */
  companies: string[];
  /** `company_domain` per hit, same order as `companies`; empty string when absent. */
  domains: string[];
  /** `title` per hit, same order as `companies`. Absent = no title evidence, no veto. */
  titles?: string[];
}

/**
 * Case/whitespace/punctuation-insensitive company-name comparison. Stored
 * names are compared as-is — legal-suffix stripping for intent lives in
 * `companyNameStem`, which reuses the display stem from `displayCompanyName`.
 */
export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Display stem normalized for intent comparison — empty stem fails open. */
export function companyNameStem(value: string): string {
  return normalizeCompanyName(displayCompanyName(value));
}

/**
 * Does the typed query name an employer the corpus knows, strongly enough to
 * scope the search to the `company` attribute?
 *
 * Pure — the caller supplies the probe result, so this is unit-testable with
 * no Meilisearch and no mocks.
 */
function companyStemMatches(queryStem: string, company: string): boolean {
  if (!queryStem) return false;
  return companyNameStem(company) === queryStem;
}

/** Does `title` contain every word of the (already normalized) query stem? */
function titleRepeatsQuery(needle: string, title: string): boolean {
  const words = new Set(normalizeCompanyName(title).split(" "));
  return needle.split(" ").every((w) => words.has(w));
}

export function isCompanyNameQuery(q: string, sample: CompanyNameSample): boolean {
  const needle = companyNameStem(q);
  if (!needle) return false;
  const inspected = sample.companies.length;
  if (inspected === 0) return false;
  const named = sample.companies.flatMap((c, i) => (companyStemMatches(needle, c ?? "") ? [i] : []));
  if (named.length < COMPANY_INTENT_MIN_EXACT) return false;
  if (named.length / inspected < COMPANY_INTENT_MIN_RATIO) return false;
  const titles = named.map((i) => sample.titles?.[i] ?? "").filter(Boolean);
  const echoed = titles.filter((t) => titleRepeatsQuery(needle, t)).length;
  return titles.length === 0 || echoed / titles.length < COMPANY_INTENT_MAX_TITLE_ECHO;
}

/**
 * Dominant employer domains from a sample that already passed `isCompanyNameQuery`.
 * Returns 0–N lowercase domains that meet the same count/ratio floors.
 */
export function dominantCompanyDomains(q: string, sample: CompanyNameSample): string[] {
  if (!isCompanyNameQuery(q, sample)) return [];
  const needle = companyNameStem(q);
  if (!needle) return [];

  const inspected = sample.companies.length;
  const domainCounts = new Map<string, number>();
  for (let i = 0; i < inspected; i++) {
    if (!companyStemMatches(needle, sample.companies[i] ?? "")) continue;
    const domain = (sample.domains[i] ?? "").trim().toLowerCase();
    if (!domain) continue;
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  const qualified: string[] = [];
  for (const [domain, count] of domainCounts) {
    if (count >= COMPANY_INTENT_MIN_EXACT && count / inspected >= COMPANY_INTENT_MIN_RATIO) {
      qualified.push(domain);
    }
  }
  return qualified.sort();
}

/**
 * The name to show for the employer a sample named: the display form of the
 * first company in it whose name IS the query (the rows `dominantCompanyDomains`
 * counted). Undefined when none is.
 */
export function employerDisplayName(q: string, sample: CompanyNameSample): string | undefined {
  const needle = companyNameStem(q);
  const company = sample.companies.find((c) => companyStemMatches(needle, c ?? ""));
  return company ? displayCompanyName(company) || company : undefined;
}

/** How many role + employer splits one query may ask the corpus about (asked at once). */
export const MAX_COMPOUND_PROBES = 4;

/**
 * Pure: the first split (in `extractCompoundRoleCompanyCandidates`' order)
 * whose employer words name an employer in the corpus, read from one company
 * probe per split (`samples[i]` answers `candidates[i]`). Null when none does.
 */
export function pickCompoundEmployer(
  candidates: readonly { roleQ: string; companyQ: string }[],
  samples: readonly CompanyNameSample[],
): { roleQ: string; companyQ: string; domains: string[]; name?: string } | null {
  for (let i = 0; i < candidates.length; i++) {
    const sample = samples[i];
    if (!sample) continue;
    const domains = dominantCompanyDomains(candidates[i].companyQ, sample);
    if (domains.length > 0) {
      return { ...candidates[i], domains, name: employerDisplayName(candidates[i].companyQ, sample) };
    }
  }
  return null;
}

/**
 * Pure: when no split's employer clears the floors above, the first split
 * (same order) whose employer words ARE the name of some rows in the sample,
 * however few: "bank of america" with two live roles is still an employer
 * the corpus knows, below `COMPANY_INTENT_MIN_EXACT`. Its `domains` are every
 * domain those rows carry; which of them the employer owns is the corpus's
 * second answer (`ownedDomains`), because a job board can carry a row under
 * the employer's name. Only for the not-found path: the search tries this
 * after the whole query's rows turned out to be about something else, so a
 * junk one-row "employer" never outranks a real match.
 */
export function namedCompoundEmployer(
  candidates: readonly { roleQ: string; companyQ: string }[],
  samples: readonly CompanyNameSample[],
): { roleQ: string; companyQ: string; domains: string[]; name?: string } | null {
  for (let i = 0; i < candidates.length; i++) {
    const sample = samples[i];
    const needle = companyNameStem(candidates[i].companyQ);
    if (!sample || !needle) continue;
    const domains = [
      ...new Set(
        sample.companies.flatMap((c, j) => {
          const domain = (sample.domains[j] ?? "").trim().toLowerCase();
          return companyStemMatches(needle, c ?? "") && domain ? [domain] : [];
        }),
      ),
    ];
    if (domains.length > 0) return { ...candidates[i], domains: domains.sort(), name: employerDisplayName(candidates[i].companyQ, sample) };
  }
  return null;
}

/**
 * Least share of a domain's live rows that must carry an employer's name for
 * the domain to be that employer's own. A job board that lists one "Bank of
 * America" posting among fifty others carries the name on 2% of its rows; the
 * employer's own domain carries it on most. Filtering on a board's domain
 * would list the board's other employers as the employer's roles.
 */
export const EMPLOYER_OWNS_DOMAIN_SHARE = 0.5;

/** Per domain: live rows whose employer name matches, and live rows in all. */
export type DomainNameCounts = ReadonlyMap<string, { named: number; total: number }>;

/**
 * Pure: the domains an employer owns, by `EMPLOYER_OWNS_DOMAIN_SHARE`, best
 * share first. Counts missing (the probe failed, or the index cannot count by
 * domain) leave `domains` as they were: failing open keeps today's behaviour.
 */
export function ownedDomains(domains: readonly string[], counts: DomainNameCounts | null): string[] {
  if (!counts) return [...domains];
  const share = (d: string) => {
    const c = counts.get(d);
    return c && c.total > 0 ? c.named / c.total : 0;
  };
  return domains
    .filter((d) => share(d) >= EMPLOYER_OWNS_DOMAIN_SHARE)
    .sort((a, b) => share(b) - share(a) || (counts.get(b)?.named ?? 0) - (counts.get(a)?.named ?? 0));
}

/** Pin retrieve to probed employer domains unless `?company=` already set. */
export function applyCompanyDomainPin(
  p: JobSearchParams,
  intent: { companyScoped: boolean; companyDomains: string[]; residualRoleQ?: string },
): JobSearchParams {
  const hasCompanyPin =
    (intent.companyScoped || Boolean(intent.residualRoleQ)) && intent.companyDomains.length > 0;
  if (!hasCompanyPin || p.companyDomain || p.companyDomains?.length) return p;
  const nextQ = intent.residualRoleQ ?? p.q;
  if (intent.companyDomains.length === 1) {
    return { ...p, q: nextQ, companyDomain: intent.companyDomains[0] };
  }
  return { ...p, q: nextQ, companyDomains: intent.companyDomains };
}

const ROLE_CONNECTORS = new Set(["of", "and", "&", "for", "to", "in"]);

const ROLE_HEAD_NOUNS = new Set([
  "engineer", "engineers", "engineering",
  "developer", "developers",
  "manager", "managers", "management",
  "director", "directors",
  "designer", "designers",
  "analyst", "analysts",
  "scientist", "scientists",
  "architect", "architects",
  "consultant", "consultants",
  "specialist", "specialists",
  "coordinator", "coordinators",
  "administrator", "administrators",
  "associate", "associates",
  "assistant", "assistants",
  "lead", "leader", "leaders",
  "head", "vp", "president", "chief", "officer",
  "intern", "internship",
  "recruiter", "recruiters",
  "accountant", "accountants",
  "counsel", "attorney", "lawyer",
  "nurse", "nurses", "nursing",
  "physician", "physicians", "doctor",
  "therapist", "therapists",
  "pharmacist", "pharmacists",
  "technician", "technicians",
  "mechanic", "mechanics",
  "electrician", "electricians",
  "plumber", "plumbers",
  "welder", "welders",
  "driver", "drivers",
  "cashier", "cashiers",
  "server", "servers", "barista", "chef", "cook",
  "teacher", "teachers", "professor", "instructor",
  "researcher", "researchers",
  "writer", "writers", "editor", "editors", "producer",
  "strategist", "planner", "buyer",
  "underwriter", "actuary", "auditor", "controller", "bookkeeper",
  "paralegal", "clerk", "receptionist",
  "supervisor", "supervisors", "foreman", "superintendent", "inspector",
  "operator", "operators", "machinist", "assembler", "handler",
  "representative", "representatives", "advisor", "advisors", "advocate",
  "executive", "executives", "partner", "principal", "fellow",
  "pm", "swe", "sre", "tpm", "em", "ae", "sdr", "bdr", "csm", "rn",
]);

const ROLE_VOCABULARY_TOKENS = new Set([
  ...ROLE_HEAD_NOUNS,
  "product", "program", "project", "software", "hardware", "data", "machine", "learning",
  "ai", "ml", "cloud", "devops", "security", "cybersecurity", "network", "systems", "system",
  "platform", "infrastructure", "frontend", "front", "end", "backend", "back", "fullstack", "full", "stack",
  "mobile", "ios", "android", "web", "qa", "test", "quality", "automation", "release", "site", "reliability",
  "database", "solutions", "enterprise", "technical", "business", "intelligence", "financial", "finance",
  "accounting", "tax", "audit", "risk", "compliance", "legal", "hr", "human", "resources", "people",
  "talent", "acquisition", "marketing", "growth", "brand", "content", "social", "media", "digital",
  "seo", "paid", "performance", "demand", "generation", "sales", "account", "customer", "success",
  "support", "service", "services", "client", "operations", "ops", "revenue", "revops", "supply", "chain",
  "logistics", "procurement", "purchasing", "inventory", "manufacturing", "industrial", "mechanical",
  "electrical", "civil", "chemical", "structural", "aerospace", "biomedical", "environmental", "process",
  "materials", "packaging", "clinical", "medical", "healthcare", "health", "registered", "licensed",
  "practical", "physical", "occupational", "speech", "respiratory", "radiology", "dental", "veterinary",
  "pharmacy", "ux", "ui", "graphic", "visual", "motion", "interaction", "creative", "art", "copywriter",
  "communications", "public", "relations", "pr", "investor", "corporate", "strategy", "development",
  "investment", "banking", "equity", "portfolio", "wealth", "asset", "credit", "loan", "mortgage",
  "real", "estate", "property", "facilities", "construction", "field", "retail", "store", "branch",
  "shift", "kitchen", "restaurant", "hotel", "hospitality", "event", "administrative", "office",
  "personal", "virtual", "general", "senior", "sr", "junior", "jr", "mid", "entry", "level",
  "staff", "group", "vice", "co", "op", "graduate", "new", "grad", "trainee", "apprentice",
  "warehouse", "production", "analytics", "science", "design", "research", "it", "information", "technology",
  "ii", "iii", "iv", "v", "1", "2", "3",
]);

function cleanWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRolePhraseWords(words: readonly string[]): boolean {
  if (words.length === 0) return false;
  // "director of" is half a role: the connector belongs between its words, never at an end.
  if (ROLE_CONNECTORS.has(cleanWord(words[0])) || ROLE_CONNECTORS.has(cleanWord(words[words.length - 1]))) return false;
  const cleaned = words.map(cleanWord).filter(Boolean);
  if (cleaned.length === 0) return false;
  const allRoleOrConnector = cleaned.every((w) => ROLE_VOCABULARY_TOKENS.has(w) || ROLE_CONNECTORS.has(w));
  if (!allRoleOrConnector) return false;
  return cleaned.some((w) => ROLE_HEAD_NOUNS.has(w));
}

/** Most words an employer name in a role + employer query may hold ("Integral Ad Science", "Bank of Nova Scotia"). */
export const MAX_COMPANY_WORDS = 4;

const isConnectorWord = (w: string) => ROLE_CONNECTORS.has(w.toLowerCase());

/**
 * Can these words be an employer's name? An employer's name may hold role
 * words ("Integral Ad SCIENCE", "CAPITAL One", "Bank OF America") and a
 * connector inside it ("Johnson & Johnson"), but never only role words, and
 * never a connector at either end. Before 2026-11-08 every word had to be a
 * non-role word and the name at most two words long, so "product manager
 * integral ad science" was never read as role + employer (Vivek's report);
 * whether the words ARE an employer is still the corpus's call
 * (`dominantCompanyDomains`), never this function's.
 */
function isCandidateCompanyWords(words: readonly string[]): boolean {
  if (words.length === 0 || words.length > MAX_COMPANY_WORDS) return false;
  if (isConnectorWord(words[0]) || isConnectorWord(words[words.length - 1])) return false;
  const cleaned = words.map(cleanWord);
  if (cleaned.some((w, i) => !w && words[i] !== "&")) return false;
  return cleaned.some((w) => w.length >= 2 && !ROLE_VOCABULARY_TOKENS.has(w) && !ROLE_CONNECTORS.has(w));
}

/**
 * Words a job search carries that never name an employer on their own ("jobs
 * canada", "careers toronto"): with the role vocabulary and the connectors,
 * what `isEmployerWord` leaves out.
 */
const SEARCH_FILLER_WORDS = new Set([
  "job", "jobs", "work", "works", "career", "careers", "hiring", "hire", "position", "positions",
  "role", "roles", "opening", "openings", "vacancy", "vacancies", "opportunity", "opportunities",
  "near", "me", "remote", "hybrid", "onsite", "time", "part", "contract", "temporary", "internships",
]);

/**
 * Can this one word carry an employer's name ("bank" in "bank of america",
 * "air" in "air canada")? Not a role word, a connector, a function word or a
 * job-search filler word ("jobs canada" names no employer). Used where a
 * place match sits inside the words: only a span holding such a word is
 * asked whether it is an employer's whole name (query-understanding.ts).
 */
export function isEmployerWord(word: string): boolean {
  const w = cleanWord(word);
  return (
    w.length >= 2 &&
    !ROLE_VOCABULARY_TOKENS.has(w) &&
    !ROLE_CONNECTORS.has(w) &&
    !SEARCH_FILLER_WORDS.has(w) &&
    !FUNCTION_WORD_SET.has(w)
  );
}

const FUNCTION_WORD_SET: ReadonlySet<string> = new Set(FUNCTION_WORDS);

/**
 * Pure: extracts candidate `{ roleQ, companyQ }` splits from a multi-word query
 * like `"Product Manager tesla"`, `"tesla Product Manager"`, `"Product Manager at Tesla"`
 * or `"product manager integral ad science"`. Returns `[]` for pure role queries
 * (`"product manager"`, `"registered nurse"`, `"director brand"`) so they never
 * trigger an extra company probe.
 *
 * Order is the order the corpus is asked in, and the first split whose words
 * name an employer wins: the employer named after the role (suffix: "product
 * manager shopify", the way people type it) before the one named before it,
 * and within each the LONGER employer name first, because a role word next to
 * the name may belong to either ("integral ad science product manager" is
 * tried as "integral ad science" before "integral ad"). A split whose employer
 * the corpus does not know costs one probe and is dropped.
 */
export function extractCompoundRoleCompanyCandidates(
  q: string,
): Array<{ roleQ: string; companyQ: string }> {
  const trimmed = q.trim();
  if (!trimmed || trimmed.includes('"') || /\bOR\b/.test(trimmed)) return [];
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8) return [];

  // Explicit "at" / "@" connector: e.g. "Product Manager at Tesla"
  const atIdx = words.findIndex((w, i) => i >= 1 && i <= words.length - 2 && /^(?:at|@)$/i.test(w));
  if (atIdx !== -1) {
    const roleWords = words.slice(0, atIdx);
    const companyWords = words.slice(atIdx + 1);
    if (isRolePhraseWords(roleWords) && isCandidateCompanyWords(companyWords)) {
      return [{ roleQ: roleWords.join(" "), companyQ: companyWords.join(" ") }];
    }
    return [];
  }

  // If every word is already in the role vocabulary, this is a pure role search.
  if (words.map(cleanWord).every((w) => ROLE_VOCABULARY_TOKENS.has(w) || ROLE_CONNECTORS.has(w))) {
    return [];
  }

  const out: Array<{ roleQ: string; companyQ: string }> = [];
  const seen = new Set<string>();
  const push = (roleWords: string[], companyWords: string[]) => {
    if (!isRolePhraseWords(roleWords) || !isCandidateCompanyWords(companyWords)) return;
    const roleQ = roleWords.join(" ");
    const companyQ = companyWords.join(" ");
    const key = `${roleQ.toLowerCase()}|${companyQ.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ roleQ, companyQ });
  };

  const maxK = Math.min(MAX_COMPANY_WORDS, words.length - 1);
  const longestFirst = Array.from({ length: maxK }, (_, i) => maxK - i);
  // Employer after the role: "Product Manager tesla", "product manager integral ad science"
  for (const k of longestFirst) push(words.slice(0, -k), words.slice(-k));
  // Employer before the role: "tesla Product Manager", "jpmorgan chase Product Manager"
  for (const k of longestFirst) push(words.slice(k), words.slice(0, k));
  return out;
}

/**
 * Pure: when no split's employer is in the corpus, the split whose role words
 * are the most: without the corpus's word that a role word is part of a name,
 * it reads as role ("tesla product manager" names "tesla", not "tesla
 * product"). Null when the query never read as role + employer.
 */
export function unresolvedCompoundSplit(
  candidates: readonly { roleQ: string; companyQ: string }[],
): { roleQ: string; companyQ: string } | null {
  let best: { roleQ: string; companyQ: string } | null = null;
  for (const c of candidates) {
    if (!best || c.roleQ.split(/\s+/).length > best.roleQ.split(/\s+/).length) best = c;
  }
  return best;
}
