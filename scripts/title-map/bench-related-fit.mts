/**
 * What the related roles do to a Best match list and to type-ahead, against the live index. READ-ONLY: federated
 * searches and limit-0 counts, nothing written to the index.
 *
 * For each résumé in tests/fixtures/resume-corpus (20 professions, 11 countries) and the golden TAM, CSM and PM
 * résumés, the query is the résumé's title, as someone types it. Per query:
 *  - Best match: the page's first FOR_YOU_READ_DEPTH rows (the read a Best match first page makes) and the related
 *    roles' first RELATED_PREVIEW_LIMIT rows (`relatedPreview`). The related rows a list keeps (`keepsRelatedRow`:
 *    Strong or Good for this résumé), and the first 20 rows by fit score with and without them: how many are related
 *    roles, and the Strong/Good/Stretch count. The order is by fit score alone, an approximation of the site's
 *    `sortByFit` (bands, then newer first inside a band).
 *  - Type-ahead: the related roles suggested for the typed title (`relatedSuggestions`) and how many open postings
 *    carry each as a title.
 *
 *   npx tsx --env-file=.env.local scripts/title-map/bench-related-fit.mts [out.json]
 *
 * Prints a table; writes counts, labels and job titles only (no company names, no posting text).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const { buildTieredQuerySpecs, host, meiliFetch, runCountPass, searchKey, RELATED_PREVIEW_LIMIT } = await import("@/lib/jobs/meilisearch");
const { normalizePublicJobs } = await import("@/lib/jobs/normalize-public-job");
const { relatedSuggestions } = await import("@/lib/jobs/title-neighbours");
const { keepsRelatedRow } = await import("@/lib/jobs/related-rows");
const { FOR_YOU_READ_DEPTH } = await import("@/lib/jobs/for-you/pack-filters");
const { resolveCandidateSignals } = await import("@/lib/jobs/candidate-signals");
const score = await import("@/lib/match/score");
const { resumeDataFromPlainText } = await import("@/lib/resume/structure-resume-text");
type Job = Parameters<typeof score.scoreJobAgainstResume>[1];

const TOP = 20;
const h = host();
if (!h) {
  console.error("Set MEILISEARCH_HOST and MEILISEARCH_SEARCH_KEY (e.g. --env-file=.env.local). Nothing was read.");
  process.exit(2);
}

const corpus = "tests/fixtures/resume-corpus";
const cases: Array<{ name: string; q: string; text: string }> = readdirSync(corpus)
  .filter((f) => f.endsWith(".truth.json"))
  .sort()
  .map((f) => {
    const name = f.replace(".truth.json", "");
    return { name, q: (JSON.parse(readFileSync(path.join(corpus, f), "utf8")) as { title: string }).title, text: readFileSync(path.join(corpus, `${name}.paste.txt`), "utf8") };
  });
for (const [name, file, q] of [
  ["vivek-tam", "vivek-tam-resume", "Technical Account Manager"],
  ["vivek-csm", "vivek-csm-golden-resume", "Customer Success Manager"],
  ["vivek-pm", "vivek-pm-resume", "Product Manager"],
] as const) {
  try {
    cases.push({ name, q, text: readFileSync(path.join("tests/fixtures", `${file}.txt`), "utf8") });
  } catch {
    console.error(`no tests/fixtures/${file}.txt; skipped`);
  }
}

async function federated(specs: ReturnType<typeof buildTieredQuerySpecs>, limit: number): Promise<Job[]> {
  if (specs.length === 0) return [];
  const res = await meiliFetch(`${h}/multi-search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
    body: JSON.stringify({ federation: { limit, offset: 0 }, queries: specs.map((s) => s.query) }),
  });
  if (!res.ok) throw new Error(`multi-search ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { hits: Array<Job & { _federation?: { queriesPosition?: number } }> };
  return normalizePublicJobs(body.hits.map(({ _federation, ...hit }) => ({ ...hit, tier: specs[_federation?.queriesPosition ?? -1]?.tier ?? 2 }))) as Job[];
}

const LABELS = ["Strong", "Good", "Stretch", "none"] as const;
type Label = (typeof LABELS)[number];
type Labels = Record<Label, number>;
const none = (): Labels => ({ Strong: 0, Good: 0, Stretch: 0, none: 0 });
const fmt = (l: Labels) => LABELS.map((k) => `${k[0]}${l[k]}`).join(" ");

const out: unknown[] = [];
const sums = { withRelated: 0, kept: 0, read: 0, inTop: 0, before: none(), after: none(), suggested: 0, suggestedWithPostings: 0 };
console.log(`related roles in Best match and type-ahead · ${new Date().toISOString()} · read ${FOR_YOU_READ_DEPTH} + ${RELATED_PREVIEW_LIMIT}, top ${TOP}`);
console.log("query | related rows read / kept (Strong or Good) | related rows in top 20 | top 20 before | top 20 after | type-ahead related (open postings titled so)");
for (const c of cases) {
  const resume = resumeDataFromPlainText(c.text);
  const signals = resolveCandidateSignals(resume, null);
  const scored = (j: Job) => score.scoreJobAgainstResume(resume, j, signals);
  const label = (s: ReturnType<typeof scored>): Label => (s ? score.matchBandLabel(score.matchBand(s.total)) : "none");
  const specs = buildTieredQuerySpecs({ q: c.q, sort: "relevance" });
  const [paged, preview] = await Promise.all([federated(specs, FOR_YOU_READ_DEPTH), federated(specs.filter((s) => s.tier === 3), RELATED_PREVIEW_LIMIT)]);
  const pagedIds = new Set(paged.map((j) => j.id));
  const read = preview.filter((j) => !pagedIds.has(j.id)).map((j) => ({ ...j, relatedPreview: true as const }));
  const kept = read.filter((j) => keepsRelatedRow(j, scored(j)));
  const byFit = (jobs: Job[]) =>
    jobs
      .map((j, i) => ({ j, i, s: scored(j) }))
      .sort((a, b) => (b.s?.total ?? -1) - (a.s?.total ?? -1) || a.i - b.i)
      .slice(0, TOP);
  const tally = (rows: ReturnType<typeof byFit>) => rows.reduce((acc, r) => ((acc[label(r.s)] += 1), acc), none());
  const before = byFit(paged);
  const after = byFit([...paged, ...kept]);
  const keptIds = new Set(kept.map((j) => j.id));
  const inTop = after.filter((r) => keptIds.has(r.j.id)).length;
  const suggested = relatedSuggestions(c.q, [c.q]);
  const counts = await Promise.all(suggested.map((t) => runCountPass(h, { q: t }, { titleScoped: true })));
  const row = {
    name: c.name,
    q: c.q,
    read: read.length,
    kept: kept.length,
    keptTitles: [...new Set(kept.map((j) => j.title))].slice(0, 5),
    inTop,
    before: tally(before),
    after: tally(after),
    typeAhead: suggested.map((t, i) => ({ title: t, postings: counts[i] })),
  };
  out.push(row);
  if (read.length > 0) sums.withRelated += 1;
  sums.read += read.length;
  sums.kept += kept.length;
  sums.inTop += inTop;
  for (const k of LABELS) {
    sums.before[k] += row.before[k];
    sums.after[k] += row.after[k];
  }
  sums.suggested += suggested.length;
  sums.suggestedWithPostings += counts.filter((n) => n > 0).length;
  console.log(
    `${c.q} | ${read.length} / ${kept.length} | ${inTop} | ${fmt(row.before)} | ${fmt(row.after)} | ${suggested.map((t, i) => `${t} (${counts[i]})`).join(", ") || "-"}` +
      (row.keptTitles.length ? `\n    kept e.g. ${row.keptTitles.join(" · ")}` : ""),
  );
}
console.log(
  `\nTOTAL ${cases.length} queries · ${sums.withRelated} read related rows · related rows read ${sums.read}, kept ${sums.kept} · in the top ${TOP}: ${sums.inTop}` +
    `\n  top ${TOP} before: ${fmt(sums.before)} · after: ${fmt(sums.after)}` +
    `\n  type-ahead related roles ${sums.suggested} (${sums.suggestedWithPostings} with open postings)`,
);
const file = process.argv[2];
if (file) writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), top: TOP, cases: out, sums }, null, 2) + "\n");
process.exit(0);
