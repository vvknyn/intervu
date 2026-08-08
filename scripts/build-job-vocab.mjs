#!/usr/bin/env node
/**
 * Builds the committed job-vocabulary artifact (src/lib/geo/job-vocab.ts)
 * that resolve-place.ts unions into its common-word guard (see that file's
 * GUARD_WORDS). common-words.ts alone (general English) misses job-title
 * words that aren't ordinary English but ARE extremely common in real
 * postings — "Enterprise Account Executive" still got hijacked to
 * Enterprise, AL because "enterprise" was never on a general-English list.
 * This script derives that second, DATA-driven dimension straight from our
 * own live corpus instead of hand-adding words one collision at a time.
 *
 * METHOD
 *   1. Sample real job titles from the live `jobs` Meilisearch index across
 *      a spread of seed queries (a bare "" query only ever surfaces this
 *      endpoint's ~100k-doc relevance-order window — varying the query
 *      reaches titles outside it), deduped by document id.
 *   2. Tokenize each title exactly like the scanner this guard feeds
 *      (`scanPlacePhrases`, resolve-place.ts: `q.split(/[\s,;/\-–—()]+/)`,
 *      lowercased), and count DOCUMENT frequency per token (a token counts
 *      once per title even if repeated) so one repeated-word title can't
 *      skew a token in.
 *   3. Keep tokens at/above MIN_DOC_COUNT, excluding anything already
 *      covered by common-words.ts (no point committing a duplicate).
 *   4. Safety subtraction: any surviving candidate that's ALSO a real place
 *      in our own gazetteer (data/geo/gazetteer.json) is checked against
 *      live corpus place-volume via facet-search; if it clears
 *      MAJOR_PLACE_MIN_COUNT (kept equal to PLACE_MIN_COUNT,
 *      src/lib/geo/corpus-values.ts — the same "is this a real place, not
 *      noise" bar the app already uses to license a location filter), it's
 *      excluded from the vocabulary so this list can't start eating real
 *      place searches — the exact bug PR #156 fixed, in the other direction.
 *
 * NETWORK ACCESS: this box's Meili is not reachable directly from a dev
 * machine — every request below goes over one SSH hop to the production
 * box, which has MEILI_URL / MEILI_ADMIN_KEY in /opt/jobs-sync/.env. If
 * that host is unreachable from where you're running this, SSH in first and
 * either run it from a checkout there, or open a tunnel and set MEILI_URL /
 * MEILI_ADMIN_KEY locally (this script prefers ambient env vars if both are
 * already set, skipping the SSH hop entirely).
 *
 * Usage:
 *   node scripts/build-job-vocab.mjs
 *
 * Re-run whenever the live corpus's title vocabulary should refresh (new
 * verticals, new ATS sources) — the OUTPUT is committed, this script is not
 * part of the app's build or runtime path.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const OUT_PATH = join(repoRoot, "src", "lib", "geo", "job-vocab.ts");
const GAZETTEER_PATH = join(repoRoot, "data", "geo", "gazetteer.json");
const COMMON_WORDS_PATH = join(repoRoot, "src", "lib", "geo", "common-words.ts");

const SSH_HOST = "subspace@194.163.147.154";
const REMOTE_ENV = "set -a; . /opt/jobs-sync/.env; set +a;";
// Connection multiplexing: the safety-subtraction pass below makes one SSH
// round trip per gazetteer-matching candidate — ControlMaster reuses a
// single TCP+auth handshake across all of them instead of paying it per call.
const SSH_OPTS = ["-o", "ConnectTimeout=15", "-o", "ControlMaster=auto", "-o", "ControlPersist=120", "-o", "ControlPath=/tmp/ssh-job-vocab-%C"];

/** A broad spread of common job-title words across role families and
 *  seniority levels — NOT the vocabulary itself, just enough query diversity
 *  to sample outside the empty-query relevance window (see method note 1).
 *  Includes a few words known to be affected (enterprise, success, mobile)
 *  purely to guarantee those titles are IN the sample; the words that
 *  survive into the vocabulary are decided by measured document frequency
 *  below, never by this list. */
const SEED_QUERIES = [
  "manager", "engineer", "sales", "director", "analyst", "developer", "nurse",
  "specialist", "coordinator", "assistant", "consultant", "designer",
  "technician", "representative", "administrator", "marketing", "finance",
  "operations", "customer", "product", "project", "data", "software",
  "senior", "lead", "associate", "executive", "officer", "recruiter",
  "account", "support", "supervisor", "clerk", "driver", "teacher", "chef",
  "warehouse", "retail", "logistics", "human resources", "cashier",
  "receptionist", "accountant", "account executive", "enterprise",
  "customer success", "mobile", "success",
];

/** Document-frequency floor: a token must appear in the title of at least
 *  this many SAMPLED documents to be considered job-vocabulary (not
 *  sampling noise). Measured 2026-08-08 against a 224,454-doc sample: the
 *  known gap ("enterprise") sits at 5,877 — far above any reasonable floor
 *  — while single-digit/low-double-digit counts are dominated by typos,
 *  one-off company names, and foreign-language fragments. 200 (~0.09% of
 *  the sample) lands well clear of that noise floor while still reaching
 *  well past the top of the frequency curve (205 candidates clear it vs.
 *  774 at a threshold of 50) — see job-vocab.ts's header for the resulting
 *  list size before/after the safety subtraction below. */
const MIN_DOC_COUNT = 200;

/** Same bar `PLACE_MIN_COUNT` (src/lib/geo/corpus-values.ts) already uses to
 *  decide a corpus place has enough real postings to license a location
 *  filter — reused here as "enough postings to call it a major place, not
 *  noise" rather than inventing a second number for the same signal. Not
 *  imported (this is a build-step-free .mjs script, corpus-values.ts is
 *  TypeScript) — keep in sync by hand if that constant ever moves. */
const MAJOR_PLACE_MIN_COUNT = 100;

const SAMPLE_LIMIT = 1000;
const SAMPLE_OFFSETS = [0, 1000, 2000, 3000, 4000];

function sshBash(script) {
  return execFileSync("ssh", [...SSH_OPTS, SSH_HOST, "bash -s"], {
    input: script,
    maxBuffer: 1024 * 1024 * 256,
    encoding: "utf8",
  });
}

/** Local Meilisearch access, when MEILI_URL/MEILI_ADMIN_KEY are already in
 *  the ambient env (e.g. an SSH tunnel is open) — skips the SSH hop. */
function hasLocalMeili() {
  return Boolean(process.env.MEILI_URL && process.env.MEILI_ADMIN_KEY);
}

async function meiliFetch(path, body) {
  if (hasLocalMeili()) {
    const res = await fetch(`${process.env.MEILI_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MEILI_ADMIN_KEY}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }
  const payload = JSON.stringify(body).replace(/'/g, "'\\''");
  const out = sshBash(
    `${REMOTE_ENV} curl -s -XPOST -H "Authorization: Bearer $MEILI_ADMIN_KEY" -H "content-type: application/json" "$MEILI_URL${path}" --data-binary '${payload}'`,
  );
  return JSON.parse(out);
}

/** Sample titles for one seed query across SAMPLE_OFFSETS, stopping early
 *  once offsets run past the query's own estimatedTotalHits. */
async function sampleQuery(q, docs) {
  for (const offset of SAMPLE_OFFSETS) {
    const res = await meiliFetch("/indexes/jobs/search", {
      q,
      limit: SAMPLE_LIMIT,
      offset,
      attributesToRetrieve: ["id", "title"],
    });
    for (const hit of res.hits ?? []) {
      if (hit.id && hit.title) docs.set(hit.id, hit.title);
    }
    if (offset + SAMPLE_LIMIT >= (res.estimatedTotalHits ?? 0)) break;
  }
}

const TOKEN_RE = /[\s,;/\-–—()]+/; // must match scanPlacePhrases (resolve-place.ts)

function tokenize(title) {
  return title
    .split(TOKEN_RE)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** Pulls COMMON_WORDS' final membership out of common-words.ts without a
 *  cross-runtime TS import: that module's inflection is pattern-only
 *  (spelling rules, not per-word logic), so evaluating its transpiled
 *  output isn't available here — instead this greps every quoted lemma out
 *  of the source and inflects with the SAME regex-shaped suffix rules,
 *  which is exactly what that file documents its own expansion as. Used
 *  only to avoid committing a job-vocab entry that's already covered. */
function loadCommonWordsApprox() {
  const src = readFileSync(COMMON_WORDS_PATH, "utf8");
  const lemmas = [...src.matchAll(/"([a-z][a-z-]*)"/g)].map((m) => m[1]);
  const out = new Set();
  for (const w of lemmas) {
    out.add(w);
    if (w.endsWith("e")) {
      out.add(`${w}s`);
      out.add(`${w.slice(0, -1)}ing`);
      out.add(`${w}d`);
    } else if (/[^aeiou]y$/.test(w)) {
      out.add(`${w.slice(0, -1)}ies`);
      out.add(`${w.slice(0, -1)}ied`);
      out.add(`${w}ing`);
    } else if (/([sxz]|[cs]h)$/.test(w)) {
      out.add(`${w}es`);
      out.add(`${w}ed`);
      out.add(`${w}ing`);
    } else {
      out.add(`${w}s`);
      out.add(`${w}ed`);
      out.add(`${w}ing`);
    }
    if (/[^aeiou]y$/.test(w)) out.add(`${w.slice(0, -1)}ily`);
    else if (w.endsWith("le")) out.add(`${w.slice(0, -2)}ly`);
    else out.add(`${w}ly`);
  }
  return out;
}

function loadGazetteerNames() {
  const data = JSON.parse(readFileSync(GAZETTEER_PATH, "utf8"));
  const names = new Map(); // lowercase name -> [{field, value}] the real corpus field(s)/casing to facet-search
  const add = (field, name) => {
    const key = name.toLowerCase();
    const list = names.get(key) ?? [];
    list.push({ field, value: name });
    names.set(key, list);
  };
  for (const [, , name] of data.countries) add("location_country", name);
  for (const [, , name] of data.admin1) add("location_state", name);
  for (const [name] of data.cities) add("location_city", name);
  return names;
}

async function main() {
  const docs = new Map(); // id -> title
  for (const q of SEED_QUERIES) await sampleQuery(q, docs);

  const docFreq = new Map();
  for (const title of docs.values()) {
    for (const tok of new Set(tokenize(title))) {
      docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
    }
  }

  const commonWords = loadCommonWordsApprox();
  const candidates = [...docFreq.entries()]
    .filter(([tok, count]) => tok.length >= 3 && !/\d/.test(tok) && count >= MIN_DOC_COUNT && !commonWords.has(tok))
    .sort((a, b) => b[1] - a[1]);

  const gazetteerNames = loadGazetteerNames();
  const excluded = [];
  const kept = [];
  for (const [tok, count] of candidates) {
    const placeMatches = gazetteerNames.get(tok);
    if (!placeMatches) {
      kept.push([tok, count]);
      continue;
    }
    let major = false;
    for (const { field, value } of placeMatches) {
      const res = await meiliFetch("/indexes/jobs/facet-search", { facetName: field, facetQuery: value });
      const hit = (res.facetHits ?? []).find((h) => h.value.toLowerCase() === tok);
      if (hit && hit.count >= MAJOR_PLACE_MIN_COUNT) {
        major = true;
        break;
      }
    }
    if (major) excluded.push([tok, count]);
    else kept.push([tok, count]);
  }

  const sampleSize = docs.size;
  const list = kept.map(([tok]) => tok).sort();
  const generated = `/**
 * Corpus-derived job-title vocabulary — the second dimension of
 * resolve-place.ts's single-token guard (GUARD_WORDS), alongside
 * common-words.ts's hand-curated general English. Different provenance,
 * same job: "enterprise" isn't common English but IS common as a job-title
 * word ("Enterprise Account Executive"), so a general-English list alone
 * still let it resolve to Enterprise, AL/KS. This list closes that class —
 * any job-title word frequent enough in our own corpus, not a hand-added
 * denylist entry.
 *
 * DERIVATION (regenerate with \`node scripts/build-job-vocab.mjs\`)
 *   Date: ${new Date().toISOString().slice(0, 10)}
 *   Sample: ${sampleSize} distinct live job postings (deduped by document id),
 *     gathered via ${SEED_QUERIES.length} seed queries (role/seniority words
 *     spanning common function and level terms) x offsets
 *     [${SAMPLE_OFFSETS.join(", ")}] against the live \`jobs\` Meilisearch
 *     index, one SSH hop to production (this box's Meili isn't reachable
 *     directly — see the script header for the exact command shape:
 *     \`ssh subspace@194.163.147.154 'set -a; . /opt/jobs-sync/.env; set +a;
 *     curl ... "$MEILI_URL/indexes/jobs/search" ...'\`).
 *   Tokenization: identical to the scanner this guards
 *     (\`scanPlacePhrases\`, resolve-place.ts — \`q.split(/[\\s,;/\\-–—()]+/)\`,
 *     lowercased); frequency counted per DOCUMENT (a token counts once per
 *     title even if repeated), so one repeated-word title can't skew a
 *     token in.
 *   Threshold: token must appear in >= ${MIN_DOC_COUNT} sampled documents'
 *     titles (MIN_DOC_COUNT in the build script), and must not already be
 *     covered by common-words.ts.
 *   Safety subtraction: ${excluded.length} candidate(s) excluded because
 *     they ALSO name a real gazetteer place with >= ${MAJOR_PLACE_MIN_COUNT}
 *     live corpus postings in the matching location facet (the same bar
 *     PLACE_MIN_COUNT, corpus-values.ts, already uses to license a location
 *     filter) — ${excluded.length ? excluded.map(([t, c]) => `"${t}" (${c} sampled titles)`).join(", ") : "none"}.
 */
export const JOB_VOCAB: Set<string> = new Set(${JSON.stringify(list, null, 2)});
`;

  writeFileSync(OUT_PATH, generated);
  console.log(`Sampled ${sampleSize} distinct postings across ${SEED_QUERIES.length} seed queries.`);
  console.log(`${candidates.length} candidates cleared MIN_DOC_COUNT=${MIN_DOC_COUNT}.`);
  console.log(`${excluded.length} excluded as major real places: ${excluded.map(([t]) => t).join(", ") || "(none)"}`);
  console.log(`Wrote ${kept.length} words to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
