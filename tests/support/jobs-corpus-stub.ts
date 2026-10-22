/**
 * An in-memory stand-in for the ONE search call (`searchJobsAction` /
 * `JobSearchParams` → `JobSearchResult`) that the /jobs board, the For-you
 * packs and the broaden ladder all share. It applies the same facet
 * semantics the index does for the fields these tests vary: AND across
 * facet keys, OR within a key (a seniority selection also matches unknown-level rows), `["any"]` = no filter, and the posted window.
 */
import type { JobSearchParams, JobSearchResult, PostedBucket, PublicJob } from '../../src/lib/jobs/types';
import type { ResumeData } from '../../src/types/resume';
import { facetValueMatches } from '../../src/lib/jobs/unknown-inclusive-facets';

export const NOW = Date.parse('2026-09-28T12:00:00Z');
const DAY_MS = 86_400_000;
const WINDOW_DAYS: Record<PostedBucket, number> = { '1d': 1, '3d': 3, '7d': 7, '30d': 30, '90d': 90, older: Infinity };

export function mkJob(id: string, fields: Partial<PublicJob> = {}): PublicJob {
    return {
        id,
        title: 'Software Engineer',
        company: 'Acme',
        company_domain: null,
        location: null,
        location_city: null,
        location_state: null,
        location_country: null,
        work_type: 'onsite',
        description: null,
        employment_type: 'full_time',
        experience_level: 'mid',
        salary_min: null,
        salary_max: null,
        salary_currency: null,
        salary_period: null,
        visa_sponsorship: null,
        tags: ['javascript', 'react'],
        apply_url: 'https://example.com',
        source: 'test',
        posted_at: new Date(NOW - DAY_MS).toISOString(),
        first_seen_at: null,
        updated_at: null,
        vacancy_status: 'open',
        ghost_badge: 'unscored',
        ...fields,
    } as PublicJob;
}

export function mkResume(profile: Partial<ResumeData['profile']> = {}): ResumeData {
    return {
        profile: {
            name: '',
            profession: 'Software Engineer',
            yearsOfExperience: 5,
            location: '',
            email: '',
            phone: '',
            linkedin: '',
            ...profile,
        },
        experience: [],
        competencies: [{ category: 'Skills', skills: ['JavaScript', 'React'] }],
        education: [],
        generatedSummary: '',
    };
}

const countriesOf = (job: PublicJob): string[] => [job.location_country ?? []].flat();

function facetMatches(job: PublicJob, params: JobSearchParams): boolean {
    const f = params.facets ?? {};
    const wanted = (key: keyof typeof f) => (f[key] ?? []).filter((v) => v !== 'any' && v !== 'all');
    const countries = wanted('location_country');
    if (countries.length > 0 && !countriesOf(job).some((c) => countries.includes(c))) return false;
    const work = wanted('work_type');
    if (work.length > 0 && !work.includes(job.work_type)) return false;
    const levels = wanted('experience_level');
    if (levels.length > 0 && !facetValueMatches('experience_level', job.experience_level, levels)) return false;
    // Mirrors `salaryMinClause`: a posting stating no salary is kept.
    const stated = job.salary_max ?? job.salary_min ?? null;
    if (params.salaryMin && stated != null && stated < params.salaryMin) return false;
    return true;
}

function inWindow(job: PublicJob, bucket: PostedBucket | undefined): boolean {
    if (!bucket || !job.posted_at) return true;
    return NOW - Date.parse(job.posted_at) <= WINDOW_DAYS[bucket] * DAY_MS;
}

export interface CorpusStub {
    search: (params: JobSearchParams) => Promise<JobSearchResult>;
    calls: JobSearchParams[];
}

/** The q text is not matched (every job is "relevant"); only the facets and window narrow. */
export function corpusStub(corpus: PublicJob[]): CorpusStub {
    const calls: JobSearchParams[] = [];
    return {
        calls,
        async search(params) {
            calls.push(params);
            const matching = corpus.filter((job) => facetMatches(job, params) && inWindow(job, params.postedBucket));
            const offset = params.offset ?? 0;
            const limit = params.limit ?? matching.length;
            return { hits: matching.slice(offset, offset + limit), total: matching.length, backend: 'meilisearch', configured: true } as JobSearchResult;
        },
    };
}
