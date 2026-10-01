/**
 * What a résumé's ranked list opens on, against the real index: the golden résumés
 * (tests/fixtures/*-resume.txt) are structured the way the site structures an upload, their
 * "All matches" pack search runs through the product's own `searchJobs`, and the rows are
 * ordered the way the deck and the ranked Search list order them. Prints the top rows and how
 * many of the top 10 and 20 are the résumé's own role.
 *
 * Also prints what the rows carry beyond the title (tags, skills, years) and, for the deck's top 10,
 * whether the full posting has a real requirements section: the inputs whole-posting matching needs.
 *
 * Read-only. Needs MEILISEARCH_HOST and MEILISEARCH_SEARCH_KEY (read from .env.local when unset).
 * Written for the 2026-09-30 report "I don't even see a single TAM role in my list"; runs
 * unchanged on an older checkout (no own-role tier there), so a before/after is two runs:
 *
 *   npx tsx scripts/audit/fit-list.mts            # every golden résumé
 *   npx tsx scripts/audit/fit-list.mts tam pm     # just these
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
}

const { resolveCandidateSignals, candidateCountries } = await import("@/lib/jobs/candidate-signals");
const { orderForYouJobsByBand } = await import("@/lib/jobs/for-you/band-order");
const { packFilters, packSearchParams } = await import("@/lib/jobs/for-you/pack-filters");
const { buildMatchQuery } = await import("@/lib/jobs/resume-match");
const { jobCountries } = await import("@/lib/jobs/resume-location");
const { searchJobs } = await import("@/lib/jobs/search");
const score = await import("@/lib/match/score");
const { resumeDataFromPlainText } = await import("@/lib/resume/structure-resume-text");

type Job = Parameters<typeof score.scoreJobAgainstResume>[1];
type Score = ReturnType<typeof score.scoreJobAgainstResume>;

/** Each golden résumé and the titles that are its own role (a hand-written check, independent of the scorer). */
const GOLDEN: Record<string, { file: string; own: RegExp }> = {
    tam: { file: "vivek-tam-resume", own: /technical account manager|\btam\b/i },
    csm: { file: "vivek-csm-golden-resume", own: /customer success|client success/i },
    okta: { file: "vivek-okta-resume", own: /customer success|technical account manager|client success/i },
    pm: { file: "vivek-pm-resume", own: /product manager|product owner|product lead/i },
};

const DEPTH = Number(process.env.FIT_LIST_DEPTH ?? 60);
const pick = process.argv.slice(2);
const names = pick.length > 0 ? pick : Object.keys(GOLDEN);
const hasTier = typeof (score as { compareFit?: unknown }).compareFit === "function";

/** The ranked Search list's order (JobsContent rankedClusters): own-role tier first where it exists. */
function searchOrder(jobs: Job[], scores: Map<string, Score>): Job[] {
    const s = score as unknown as { compareFit?: (a: Score | undefined, b: Score | undefined) => number };
    return [...jobs].sort((a, b) =>
        s.compareFit ? s.compareFit(scores.get(a.id), scores.get(b.id)) : (scores.get(b.id)?.total ?? -1) - (scores.get(a.id)?.total ?? -1),
    );
}

console.log(`fit-list audit · own-role tier ${hasTier ? "present" : "absent"} · depth ${DEPTH} · ${new Date().toISOString()}`);
for (const name of names) {
    const golden = GOLDEN[name];
    if (!golden) throw new Error(`unknown résumé "${name}" (one of ${Object.keys(GOLDEN).join(", ")})`);
    const resume = resumeDataFromPlainText(readFileSync(path.join("tests/fixtures", `${golden.file}.txt`), "utf8"));
    const signals = resolveCandidateSignals(resume, null);
    const params = packSearchParams(packFilters(resume, signals));
    const result = await searchJobs({ ...params, limit: DEPTH, offset: 0 });
    const jobs = result.hits as Job[];
    const scores = new Map(jobs.map((job) => [job.id, score.scoreJobAgainstResume(resume, job, signals)]));
    const q = buildMatchQuery(resume).q;
    const lists = {
        deck: orderForYouJobsByBand(jobs, (job: Job) => scores.get(job.id) ?? null, q),
        search: searchOrder(jobs, scores),
    };
    const countries = candidateCountries(signals);
    const has = (pick: (job: Job) => unknown) =>
        jobs.filter((job) => {
            const v = pick(job);
            return Array.isArray(v) ? v.length > 0 : v != null;
        }).length;
    console.log(`\n=== ${name} · ${resume.profile.profession} · ${resume.profile.location}`);
    console.log(`q: ${q}`);
    console.log(`filters: ${JSON.stringify(params.facets)} · posted ${params.postedBucket ?? "-"} · ${result.total} total${result.unavailable ? " · UNAVAILABLE" : ""}`);
    // What a list row carries beyond its title, for matching on the whole posting (read off the list payload).
    console.log(
        `fields on the ${jobs.length} rows: tags ${has((j) => j.tags)} · must_have_skills ${has((j) => j.must_have_skills)} · ` +
            `tech_stack ${has((j) => j.tech_stack)} · min_years_experience ${has((j) => j.min_years_experience)}`,
    );
    // The full posting behind the deck's top 10 (one id lookup each): is there a real requirements section?
    const full = (
        await Promise.all(lists.deck.slice(0, 10).map((job) => searchJobs({ id: job.id, limit: 1, offset: 0, hideGhosts: false })))
    ).flatMap((r) => r.hits as Job[]);
    console.log(
        `top-10 postings: skills section found ${full.filter((j) => j.skills_section_found === true).length}/${full.length} · ` +
            `description chars median ${[...full.map((j) => (j.description ?? "").length)].sort((a, b) => a - b)[Math.floor(full.length / 2)] ?? 0}`,
    );
    for (const job of full.slice(0, 3)) {
        console.log(`   ${(job.title ?? "").slice(0, 50)} · must ${JSON.stringify((job.must_have_skills ?? []).slice(0, 8))} · preferred ${JSON.stringify((job.preferred_skills ?? []).slice(0, 5))} · stack ${JSON.stringify((job.tech_stack ?? []).slice(0, 6))} · min yrs ${job.min_years_experience ?? "-"}`);
    }
    for (const [list, ordered] of Object.entries(lists)) {
        const own = (n: number) => ordered.slice(0, n).filter((job) => golden.own.test(job.title ?? "")).length;
        const bands = (n: number) =>
            ordered.slice(0, n).reduce<Record<string, number>>((acc, job) => {
                const label = score.matchBandLabel(score.matchBand(scores.get(job.id)?.total ?? 0));
                acc[label] = (acc[label] ?? 0) + 1;
                return acc;
            }, {});
        const firstOther = ordered.findIndex((job) => !golden.own.test(job.title ?? ""));
        const behind = firstOther < 0 ? 0 : ordered.slice(firstOther).filter((job) => golden.own.test(job.title ?? "")).length;
        console.log(
            `-- ${list}: own role in top 10 ${own(10)}/10 · top 20 ${own(20)}/20 · all ${own(ordered.length)}/${ordered.length} · ` +
                `first other role #${firstOther + 1 || "-"}, own-role rows below it ${behind} · top-10 bands ${JSON.stringify(bands(10))}`,
        );
        if (list !== "deck") continue;
        ordered.slice(0, 20).forEach((job, i) => {
            const s = scores.get(job.id) as (Score & { role?: string }) | null;
            const where = jobCountries(job).join("/") || (job.work_type === "remote" ? "remote, no country" : "?");
            const away = countries.length > 0 && jobCountries(job).length > 0 && !jobCountries(job).some((c: string) => countries.includes(c)) ? " ABROAD" : "";
            console.log(
                `${String(i + 1).padStart(2)}. ${golden.own.test(job.title ?? "") ? "*" : " "} ${(job.title ?? "").slice(0, 58).padEnd(58)} ${(job.experience_level ?? "-").padEnd(8)} ${String(s?.total ?? "-").padStart(3)} ${score.matchBandLabel(score.matchBand(s?.total ?? 0)).padEnd(7)} ${(s?.role ?? "").padEnd(10)} ${where}${away}`,
            );
        });
    }
}
process.exit(0);
