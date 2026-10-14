/**
 * The meaning match (embedding sidecar) blended into relevance (Vivek, 2026-10-13: add semantic
 * matching between the résumé and the posting). The sidecar is stubbed; the blend is pure.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { semanticFitFromCosine, withSemanticFit, resumeEmbedText } from '../../src/lib/match/semantic-fit';
import { SEMANTIC_COS_HI, SEMANTIC_COS_LO } from '../../src/lib/match/semantic-scale';
import { scoreJobAgainstResume } from '../../src/lib/match/score';
import { resolveCandidateSignals } from '../../src/lib/jobs/candidate-signals';
import { mkJob } from '../support/jobs-corpus-stub';
import type { ResumeData } from '../../src/types/resume';

const RESUME = {
    profile: { name: 'A', profession: 'Product Manager', location: 'Toronto, Ontario', yearsOfExperience: 6 },
    experience: [{ id: 'e', company: 'X', role: 'Product Manager', dates: '2020 - Present', description: 'Owned the roadmap, prioritization and launches for a B2B SaaS platform.' }],
    competencies: [{ category: 'Skills', skills: ['Roadmap', 'SQL'] }],
    education: [],
    generatedSummary: 'Product Manager with six years in B2B SaaS.',
} as unknown as ResumeData;

describe('semantic fit', () => {
    it('reads a cosine as 0–1 between the calibrated ends', () => {
        assert.equal(semanticFitFromCosine(SEMANTIC_COS_LO - 0.1), 0);
        assert.equal(semanticFitFromCosine(SEMANTIC_COS_HI + 0.1), 1);
        assert.ok(Math.abs(semanticFitFromCosine((SEMANTIC_COS_LO + SEMANTIC_COS_HI) / 2) - 0.5) < 1e-9);
    });
    it('embeds the résumé as one passage of what they do and did', () => {
        const text = resumeEmbedText(RESUME);
        assert.match(text, /Product Manager/);
        assert.match(text, /roadmap, prioritization/);
        assert.match(text, /Skills: Roadmap, SQL/);
    });
    it('a posting close in meaning scores higher than one that only shares the title', () => {
        const job = (semantic_fit: number) => mkJob('p', { title: 'Product Manager', experience_level: 'mid', location_country: 'Canada', tags: [], semantic_fit });
        const signals = resolveCandidateSignals(RESUME, null);
        const close = scoreJobAgainstResume(RESUME, job(0.9), signals)!;
        const far = scoreJobAgainstResume(RESUME, job(0.1), signals)!;
        assert.ok(close.total > far.total, `${close.total} vs ${far.total}`);
        assert.equal(close.components[0]!.jd?.semantic, 0.9);
    });
    it('leaves the hits as they were when the sidecar fails', async () => {
        const hits = [mkJob('a', { title: 'Product Manager' })];
        const out = await withSemanticFit(hits, RESUME, { url: 'http://sidecar.test', fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch });
        assert.equal(out[0]!.semantic_fit, undefined);
    });
    it('with no sidecar configured, returns the hits at once and calls nothing', async () => {
        const saved = process.env.VELAI_EMBED_URL;
        delete process.env.VELAI_EMBED_URL;
        try {
            let calls = 0;
            const hits = [mkJob('a', { title: 'Product Manager' })];
            const started = Date.now();
            const out = await withSemanticFit(hits, RESUME, { fetchImpl: (async () => { calls += 1; throw new Error('should not be called'); }) as unknown as typeof fetch });
            assert.equal(out, hits);
            assert.equal(calls, 0);
            assert.ok(Date.now() - started < 50, 'no read, no wait');
        } finally {
            if (saved !== undefined) process.env.VELAI_EMBED_URL = saved;
        }
    });
    it('reads the sidecar address from VELAI_EMBED_URL, without a trailing slash', async () => {
        const saved = process.env.VELAI_EMBED_URL;
        process.env.VELAI_EMBED_URL = 'http://sidecar.test:8080/';
        try {
            const seen: string[] = [];
            const hits = [mkJob('a', { title: 'Product Manager' })];
            await withSemanticFit(hits, RESUME, { fetchImpl: (async (input: RequestInfo | URL) => { seen.push(String(input)); throw new Error('down'); }) as unknown as typeof fetch });
            assert.deepEqual(seen, ['http://sidecar.test:8080/similarity']);
        } finally {
            if (saved === undefined) delete process.env.VELAI_EMBED_URL;
            else process.env.VELAI_EMBED_URL = saved;
        }
    });
});
