/**
 * What the "roles next to this one" band (tier 3, `relatedRoleSpecs`) does to real searches, against the live index.
 * READ-ONLY: limit-0 counts and two federated searches per query, nothing written to the index.
 *
 * For each résumé in tests/fixtures/resume-corpus (20 professions, 11 countries) and the golden TAM, CSM and PM
 * résumés, the query is the résumé's title, as someone types it. Per query:
 *  - the related titles the table gives (`relatedTitlesFor`) and how many open postings carry each as a title;
 *  - the first 100 rows with the band and without it (the same federated queries minus tier 3): how many related
 *    rows reach the top 40 and the top 100, and which rows they push out (mentions);
 *  - the match label each of those rows gets for that résumé (`scoreJobAgainstResume`): are the added rows a better
 *    fit than the ones they push out?
 *  - how many postings carry the title itself, and the labels of the first 40 title rows against the first 40 rows of
 *    the related titles alone (the band's queries only): would related rows fit as well as title rows if they were
 *    placed among them?
 *
 *   npx tsx --env-file=.env.local scripts/title-map/bench-related.mts [out.json]
 *
 * Prints a table; writes counts, labels and job titles only (no company names, no posting text).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const { buildTieredQuerySpecs, host, meiliFetch, runCountPass, searchKey } = await import("@/lib/jobs/meilisearch");
const { normalizePublicJobs } = await import("@/lib/jobs/normalize-public-job");
const { relatedTitlesFor } = await import("@/lib/jobs/title-neighbours");
const { resolveCandidateSignals } = await import("@/lib/jobs/candidate-signals");
const score = await import("@/lib/match/score");
const { resumeDataFromPlainText } = await import("@/lib/resume/structure-resume-text");
type Job = Parameters<typeof score.scoreJobAgainstResume>[1];

const DEPTH = 100;
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

async function federated(specs: ReturnType<typeof buildTieredQuerySpecs>): Promise<Job[]> {
  const res = await meiliFetch(`${h}/multi-search`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
    body: JSON.stringify({ federation: { limit: DEPTH, offset: 0 }, queries: specs.map((s) => s.query) }),
  });
  if (!res.ok) throw new Error(`multi-search ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { hits: Array<Job & { _federation?: { queriesPosition?: number } }> };
  return normalizePublicJobs(body.hits.map(({ _federation, ...hit }) => ({ ...hit, tier: specs[_federation?.queriesPosition ?? -1]?.tier ?? 2 }))) as Job[];
}

const LABELS = ["Strong", "Good", "Stretch", "none"] as const;
type Labels = Record<(typeof LABELS)[number], number>;
const tally = (jobs: Job[], label: (j: Job) => (typeof LABELS)[number]): Labels =>
  jobs.reduce((acc, j) => ((acc[label(j)] += 1), acc), { Strong: 0, Good: 0, Stretch: 0, none: 0 } as Labels);
const fmt = (l: Labels) => LABELS.map((k) => `${k[0]}${l[k]}`).join(" ");

const out: unknown[] = [];
const none = (): Labels => ({ Strong: 0, Good: 0, Stretch: 0, none: 0 });
const sums = { related: 0, withPostings: 0, top40: 0, top100: 0, added: none(), pushedOut: none(), titleRows40: none(), relatedRows40: none() };
console.log(`related-roles bench · ${new Date().toISOString()} · depth ${DEPTH}`);
console.log("query (postings titled so) | related titles (open postings titled so) | related rows top 40 / top 100 | added rows S/G/St/none | pushed-out rows S/G/St/none | first 40 title rows | first 40 related-only rows");
for (const c of cases) {
  const resume = resumeDataFromPlainText(c.text);
  const signals = resolveCandidateSignals(resume, null);
  const label = (j: Job) => {
    const s = score.scoreJobAgainstResume(resume, j, signals);
    return s ? score.matchBandLabel(score.matchBand(s.total)) : "none";
  };
  const p = { q: c.q, sort: "relevance" as const };
  const related = relatedTitlesFor(c.q);
  const [titled, ...counts] = await Promise.all([c.q, ...related].map((t) => runCountPass(h, { q: t }, { titleScoped: true })));
  const specs = buildTieredQuerySpecs(p);
  const relatedSpecs = specs.filter((s) => s.tier === 3);
  const [after, before, relatedOnly] = await Promise.all([
    federated(specs),
    federated(specs.filter((s) => s.tier !== 3)),
    relatedSpecs.length > 0 ? federated(relatedSpecs) : Promise.resolve([] as Job[]),
  ]);
  const added = after.filter((j) => j.tier === 3);
  const afterIds = new Set(after.map((j) => j.id));
  const pushedOut = before.filter((j) => !afterIds.has(j.id));
  const row = {
    name: c.name,
    q: c.q,
    titled,
    related: related.map((t, i) => ({ title: t, postings: counts[i] })),
    top40: after.slice(0, 40).filter((j) => j.tier === 3).length,
    top100: added.length,
    added: tally(added, label),
    pushedOut: tally(pushedOut, label),
    sampleAdded: added.slice(0, 5).map((j) => j.title),
    titleRows40: tally(after.filter((j) => j.tier === 1).slice(0, 40), label),
    relatedRows40: tally(relatedOnly.slice(0, 40), label),
    sampleRelatedOnly: relatedOnly.slice(0, 5).map((j) => j.title),
  };
  out.push(row);
  sums.related += related.length;
  sums.withPostings += counts.filter((n) => n > 0).length;
  sums.top40 += row.top40;
  sums.top100 += row.top100;
  for (const k of LABELS) {
    sums.added[k] += row.added[k];
    sums.pushedOut[k] += row.pushedOut[k];
    sums.titleRows40[k] += row.titleRows40[k];
    sums.relatedRows40[k] += row.relatedRows40[k];
  }
  console.log(
    `${c.q} (${titled}) | ${related.map((t, i) => `${t} (${counts[i]})`).join(", ") || "-"} | ${row.top40} / ${row.top100} | ${fmt(row.added)} | ${fmt(row.pushedOut)} | ${fmt(row.titleRows40)} | ${fmt(row.relatedRows40)}` +
      (row.sampleAdded.length ? `\n    added e.g. ${row.sampleAdded.join(" · ")}` : "") +
      (row.sampleRelatedOnly.length ? `\n    related-only e.g. ${row.sampleRelatedOnly.join(" · ")}` : ""),
  );
}
console.log(
  `\nTOTAL ${cases.length} queries · related titles ${sums.related} (${sums.withPostings} with open postings) · related rows in top 40: ${sums.top40}, top 100: ${sums.top100}` +
    `\n  added rows: ${fmt(sums.added)} · rows they pushed out of the top 100: ${fmt(sums.pushedOut)}` +
    `\n  first 40 title rows: ${fmt(sums.titleRows40)} · first 40 related-only rows: ${fmt(sums.relatedRows40)}`,
);
const file = process.argv[2];
if (file) writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), cases: out, sums }, null, 2) + "\n");
process.exit(0);
