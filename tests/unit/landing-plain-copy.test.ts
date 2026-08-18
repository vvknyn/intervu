import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexCategories } from '../../src/components/jobs/LandingMarketingShowcase';

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

    it('no card carries an unmeasured badge', () => {
        for (const cat of indexCategories) {
            assert.ok(!('metric' in cat), `${cat.domain} card still carries a metric badge`);
        }
    });
});
