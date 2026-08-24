import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { indexCategories, LandingMasthead } from '../../src/components/jobs/LandingMarketingShowcase';
import { LANDING_PROVENANCE_LINE } from '../../src/lib/marketing-stats';

/**
 * Guards the landing-page copy rewrite (2026-08-18): the page used to talk
 * like the ingestion engine that built it ("The Unfiltered Corpus.",
 * "SELECT DOMAIN TO QUERY", "FILTER_01") instead of telling a visitor what
 * this is and what to do — and every example card was a tech role, while the
 * actual corpus is dominated by non-tech (nursing, driving, trades, retail,
 * office work). This re-derives the same string-literal / JSX-text
 * extraction as tests/unit/plain-language.test.ts so a future edit can't
 * quietly bring either problem back.
 */
const TARGET = join(__dirname, '..', '..', 'src', 'components', 'jobs', 'LandingMarketingShowcase.tsx');

/**
 * Comments are where the builder's vocabulary legitimately survives (this
 * file's own doc comments explain the rewrite in those terms) — only what
 * ships to the browser is in scope.
 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // `[^:\w]` keeps the `//` in `https://` from eating the rest of a line.
        .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1');
}

/**
 * `${...}` holes are code, not copy. Stripped BEFORE matching string
 * literals, not after: a backtick nested inside an interpolation would
 * otherwise close its template early and let the next literal swallow raw
 * JS between them.
 */
function stripInterpolations(src: string): string {
    let out = src;
    for (let prev = ''; out !== prev; ) { prev = out; out = out.replace(/\$\{[^{}]*\}/g, ' '); }
    return out;
}

/**
 * Prose = a string literal or a JSX text node that reads like a sentence
 * fragment. Two WORDS, not merely a space, is what separates copy from
 * identifiers, object keys, and Tailwind tokens — none of which a user reads.
 */
const STRING_LITERAL = /"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
const JSX_TEXT = />([^<>{}]+)</g;

function proseIn(src: string): string[] {
    const clean = stripInterpolations(stripComments(src));
    const found: string[] = [];
    for (const m of clean.matchAll(STRING_LITERAL)) found.push(m[1] ?? m[2] ?? m[3] ?? '');
    for (const m of clean.matchAll(JSX_TEXT)) found.push(m[1]);
    return found.filter((s) => /[A-Za-z]\s+[A-Za-z]/.test(s));
}

/**
 * The builder's-eye-view vocabulary the rewrite replaced. `filter_` gets no
 * trailing `\b`: the fragment it bans is a PREFIX (`FILTER_01`, `FILTER_02`,
 * ...) and the digits that follow are word characters, so a trailing
 * boundary would never fire and the check would pass mutely while the
 * jargon sat right there.
 */
const BANNED_TERMS = [
    'corpus', 'ATS', 'ingestion', 'scraping', 'query', 'domain', 'edition',
    'tier-1', 'jurisdiction', 'filter_',
];

function jargonPattern(term: string): RegExp {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const trailingBoundary = term.endsWith('_') ? '' : '\\b';
    return new RegExp(`\\b${escaped}${trailingBoundary}`, 'i');
}

describe("landing page copy: plain language, not the builder's vocabulary", () => {
    it('no machine-register jargon in the user-facing copy', () => {
        const src = readFileSync(TARGET, 'utf8');
        const offenders: string[] = [];
        for (const prose of proseIn(src)) {
            for (const term of BANNED_TERMS) {
                if (jargonPattern(term).test(prose)) {
                    offenders.push(`"${term}" in: ${prose.trim().slice(0, 90)}`);
                }
            }
        }
        assert.deepEqual(offenders, [], `builder-register jargon in landing copy:\n${offenders.join('\n')}`);
    });

    /**
     * NOTE: this repo has no importable tech-keyword/tech-terms list
     * (searched before writing this test — none exists), so this cannot
     * independently verify the six cards skew non-tech the way it would if
     * one existed. It only proves the directory is six distinct fields
     * rather than one field repeated under six labels. Weaker than the
     * ideal check; see PR body.
     */
    it('the directory spans more than one field', () => {
        assert.ok(indexCategories.length >= 6, 'directory should offer at least six fields');
        const queries = indexCategories.map((cat) => cat.q);
        assert.equal(
            new Set(queries).size,
            queries.length,
            'directory cards must not collide on the same search query',
        );
    });

    it('technology leads the field directory (tech-first ICP)', () => {
        assert.equal(indexCategories[0]?.title, 'Software and tech');
        assert.equal(indexCategories[0]?.q, 'Software Engineer');
    });

    it('field directory uses human titles, not ledger chrome', () => {
        const src = readFileSync(TARGET, 'utf8');
        assert.doesNotMatch(src, /\{cat\.num\}/);
        assert.doesNotMatch(src, /\{cat\.domain\}/);
        assert.doesNotMatch(src, /\[\{cat\.domain\}\]/);
        for (const cat of indexCategories) {
            assert.ok(cat.title.length > 0, 'each field needs a human title');
            assert.match(cat.title, /[a-z]/, `${cat.title} should read like plain language`);
        }
    });

    it('no card carries an unmeasured badge', () => {
        for (const cat of indexCategories) {
            assert.ok(!('metric' in cat), `${cat.title} card still carries a metric badge`);
        }
    });
});

/**
 * Guards the chip-row/directory field-list agreement (2026-08-18): the jobs
 * toolbar's field chips used to be a second, hand-typed, all-tech list
 * (Engineering / AI & ML / Product / Design) that contradicted the field
 * directory rendered lower on the same page — and the corpus is dominated by
 * non-tech roles, so the tech-only framing was actively wrong. The fix makes
 * the chip row derive its field chips from `indexCategories`, the directory's
 * own exported single source of truth, instead of restating the list a
 * fourth time. This can't render `app/jobs/page.tsx` directly (client hooks,
 * router/search-param context, no test harness for it exists), so it checks
 * the one thing that actually distinguishes "derives from the export" from
 * "hardcodes a lookalike list": a hardcoded chip literal writes
 * `label: "some string"` (a quoted value right after the key); a derived one
 * writes `{cat.title}`/`cat.q` — a property access, never a quote. Scoped to
 * just the chip-row block (between its own comment and the next section's
 * `data-testid`) so it can't false-positive on the unrelated `label:` object
 * literals that exist elsewhere in this 4,000+ line file.
 */
describe('jobs toolbar chip row: field chips derive from indexCategories, not a parallel list', () => {
    const PAGE = join(__dirname, '..', '..', 'src', 'app', 'jobs', 'page.tsx');

    function chipRowSource(): string {
        const src = readFileSync(PAGE, 'utf8');
        const start = src.indexOf('Category & Filter Dropdowns');
        const end = src.indexOf('data-testid="jobs-toolbar"');
        assert.ok(start !== -1 && end !== -1 && end > start, 'chip-row anchors moved — update this test\'s markers');
        return src.slice(start, end);
    }

    it('references the shared indexCategories export', () => {
        assert.match(chipRowSource(), /indexCategories/, 'chip row no longer derives from indexCategories');
    });

    it('does not hardcode a quoted label (a parallel list literal)', () => {
        const offenders = chipRowSource().match(/label:\s*["'`]/g) ?? [];
        assert.deepEqual(offenders, [], 'chip row hardcodes a quoted label — restate via indexCategories instead of a parallel list');
    });
});

/**
 * Guards the masthead claim (2026-08-18): `marketClaim` in app/jobs/page.tsx
 * was computed but never passed to anything that rendered it — a dead-state
 * bug where the state existed and updated correctly but no JSX ever read it.
 * This asserts the render side directly: a non-null `claim` prop must reach
 * the page, and `null` must render nothing claim-shaped, never an invented
 * placeholder sentence.
 *
 * The claim carries provenance and no count since 2026-08-24 — see
 * `LANDING_PROVENANCE_LINE`'s own note and the class-wide guard in
 * guest-copy-jargon.test.ts.
 */
describe('LandingMasthead: renders the provenance claim (or nothing)', () => {
    it('renders the claim sentence when passed a non-null claim', () => {
        const html = renderToStaticMarkup(LandingMasthead({ claim: LANDING_PROVENANCE_LINE }));
        assert.match(html, /screened for stale postings/);
    });

    it('renders nothing claim-shaped when claim is null', () => {
        const html = renderToStaticMarkup(LandingMasthead({ claim: null }));
        assert.doesNotMatch(html, /live roles/);
        assert.doesNotMatch(html, /screened for stale postings/);
        // The h1 still renders — only the claim paragraph is conditional.
        assert.match(html, /Every job, straight from the employer\./);
    });

    it('is what the page actually passes — the claim is a constant, not fetched state', () => {
        // The 2026-08-18 bug was the prop never arriving. Its 2026-08-24 shape
        // would be the page reintroducing a count-bearing sentence of its own,
        // so assert the call site by source rather than only the component.
        const pageSrc = readFileSync(
            new URL('../../src/app/jobs/page.tsx', import.meta.url),
            'utf8',
        );
        assert.match(pageSrc, /<LandingMasthead claim=\{LANDING_PROVENANCE_LINE\} \/>/);
    });
});
