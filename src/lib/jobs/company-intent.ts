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
  const cleaned = words.map(cleanWord).filter(Boolean);
  if (cleaned.length === 0) return false;
  const allRoleOrConnector = cleaned.every((w) => ROLE_VOCABULARY_TOKENS.has(w) || ROLE_CONNECTORS.has(w));
  if (!allRoleOrConnector) return false;
  return cleaned.some((w) => ROLE_HEAD_NOUNS.has(w));
}

function isCandidateCompanyWords(words: readonly string[]): boolean {
  if (words.length === 0 || words.length > 2) return false;
  const cleaned = words.map(cleanWord).filter(Boolean);
  if (cleaned.length !== words.length) return false;
  return cleaned.every((w) => w.length >= 2 && !ROLE_VOCABULARY_TOKENS.has(w) && !ROLE_CONNECTORS.has(w));
}

/**
 * Pure: extracts candidate `{ roleQ, companyQ }` splits from a multi-word query
 * like `"Product Manager tesla"`, `"tesla Product Manager"`, or `"Product Manager at Tesla"`.
 * Returns `[]` for pure role queries (`"product manager"`, `"registered nurse"`, `"director brand"`)
 * so they never trigger an extra company probe.
 */
export function extractCompoundRoleCompanyCandidates(
  q: string,
): Array<{ roleQ: string; companyQ: string }> {
  const trimmed = q.trim();
  if (!trimmed || trimmed.includes('"') || /\bOR\b/.test(trimmed)) return [];
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return [];

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

  // Suffix company (1 word, then 2 words): e.g. "Product Manager tesla", "Product Manager jpmorgan chase"
  for (const k of [1, 2]) {
    if (words.length > k) {
      push(words.slice(0, -k), words.slice(-k));
    }
  }
  // Prefix company (1 word, then 2 words): e.g. "tesla Product Manager", "jpmorgan chase Product Manager"
  for (const k of [1, 2]) {
    if (words.length > k) {
      push(words.slice(k), words.slice(0, k));
    }
  }
  return out;
}
