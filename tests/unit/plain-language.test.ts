import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GHOST_META } from '../../src/lib/jobs/presentation';
import { facetValueLabel } from '../../src/components/jobs/FilterPanel';

/**
 * "Ghost job" is industry jargon. A nurse reading a results page has very
 * likely never heard it, so the product says "Possibly stale" / "Worth
 * verifying" / "Actively posted" instead. The term survives in exactly three
 * places, all deliberate: the research explainer that ranks for the search
 * (`src/app/research/ghost-jobs`), the SEO layer (`src/lib/seo`) — meta
 * descriptions, keyword lists, JSON-LD, and the `GHOST_JOB_TERM` constant that
 * every search-facing string elsewhere interpolates from — and the job-search
 * FAQ (`src/lib/faq.ts`), which answers "what is a ghost job" by name for the
 * same reason the research page does: that is the literal query it's built to
 * rank for (it feeds the FAQPage JSON-LD too), and a glossary entry that won't
 * say the word it's defining isn't plain language, it's evasive.
 *
 * That is the whole exemption rule — a ROUTE, a LAYER, and one FILE, each of
 * which speaks to search engines or explicitly defines the term rather than
 * assuming a reader already knows it. There is deliberately no broader list of
 * file names here: the previous rename went half-done precisely because the
 * labels were restated in files nobody remembered, and a guard that has to be
 * told which files to skip decays exactly the way that rename did. Any new
 * file that puts the jargon in front of a user fails this test on the day it
 * is written.
 *
 * The DATA is untouched and always will be: `ghost_badge` is a live Meili
 * facet, `ghost_job` a stored report reason, `ghosts` a URL param and
 * `includeGhostFlagged` an MCP argument. Identifiers, comments and attribute
 * values are therefore not prose and are not scanned — only the words that
 * reach a screen.
 */
const SRC = join(__dirname, '..', '..', 'src');
const EXEMPT_SUBJECT_ROUTE = join('app', 'research', 'ghost-jobs');
const EXEMPT_SEO_LAYER = join('lib', 'seo');
const EXEMPT_SEARCH_FAQ = join('lib', 'faq.ts');

/**
 * Whole-word only, and that word boundary is doing real work in three ways:
 *
 * - `ghost_badge` / `likely_ghost` / `includeGhostFlagged` are wire contracts.
 *   A `_` or a camelCase hump is a word character, so an identifier never
 *   trips this even when it is spelled out inside a string (a Meili filter
 *   expression, an MCP argument name in a tool description).
 * - "ghosted" / "ghosting" is a DIFFERENT word — a recruiter going silent on
 *   you, which is ordinary English everybody already understands. `lib/copy.ts`
 *   gets to keep its jokes.
 * - "ghost-job" and "likely ghost" — the actual jargon — are caught, because a
 *   hyphen and a space both end the word.
 */
const JARGON = /\bghosts?\b/i;

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue; }
        if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
}

/**
 * Comments are where "ghost" legitimately survives — the fields really are
 * named that, and a comment explaining `ghost_badge` should say so. Only what
 * ships to the browser is in scope.
 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // `[^:\w]` keeps the `//` in `https://` from eating the rest of a line.
        .replace(/(^|[^:\w])\/\/[^\n]*/g, '$1');
}

/**
 * `${...}` holes are code, not copy — what the reader sees is the substituted
 * VALUE, and the expression's variable names are none of this guard's business
 * (`Hide possibly stale (−${ghostHiddenCount})` renders "Hide possibly stale
 * (−1,234)"). Removing them first also repairs the scan itself: a backtick
 * nested inside an interpolation would otherwise close its template early and
 * let the next literal swallow the code between them.
 *
 * The loop collapses innermost holes first, so nested braces (an object
 * literal, a ternary with a template inside) unwind rather than defeating the
 * non-greedy match.
 */
function stripInterpolations(src: string): string {
    let out = src;
    for (let prev = ''; out !== prev; ) { prev = out; out = out.replace(/\$\{[^{}]*\}/g, ' '); }
    return out;
}

/**
 * Prose = a string literal or a JSX text node that reads like a sentence
 * fragment. The "contains a space" rule is what separates copy from
 * identifiers, facet values, test ids, hrefs and Tailwind tokens — none of
 * which a user reads, all of which legitimately keep the old vocabulary. Two
 * WORDS, not merely a space: stripping `${...}` can leave a bare path with a
 * space around it (`/research/ghost-jobs`), and a href is not copy.
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

describe('plain language: the product does not say "ghost job"', () => {
    it('no user-facing copy in src/ uses the jargon', () => {
        const offenders: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const rel = relative(SRC, file);
            if (rel.startsWith(EXEMPT_SUBJECT_ROUTE) || rel.startsWith(EXEMPT_SEO_LAYER) || rel === EXEMPT_SEARCH_FAQ) continue;
            for (const prose of proseIn(readFileSync(file, 'utf8'))) {
                if (JARGON.test(prose)) offenders.push(`${rel}: ${prose.trim().slice(0, 90)}`);
            }
        }
        assert.deepEqual(offenders, [], `jargon in user-facing copy:\n${offenders.join('\n')}`);
    });

    /**
     * The mirror of the rule above, and the reason it is an exemption rather
     * than a deletion. If somebody "finishes the rename" by scrubbing the term
     * from the research page too, the guard above still passes — silently, and
     * having become vacuous — while the page stops matching the query it was
     * built to rank for. This asserts the acquisition surface is still there.
     */
    it('the research explainer still speaks the search term', () => {
        const page = readFileSync(join(SRC, EXEMPT_SUBJECT_ROUTE, 'page.tsx'), 'utf8');
        assert.ok(
            proseIn(page).some((prose) => JARGON.test(prose)),
            'the research page no longer says "ghost job" — the exemption is now vacuous and the ranking play is gone',
        );
    });

    it('the verdict labels themselves are plain', () => {
        for (const [value, meta] of Object.entries(GHOST_META)) {
            if (!meta) continue;
            assert.ok(!JARGON.test(meta.label), `${value} label still says ghost: ${meta.label}`);
            assert.ok(!JARGON.test(meta.explain), `${value} explain still says ghost: ${meta.explain}`);
        }
    });
});

describe('plain language: one chokepoint owns the verdict labels', () => {
    /**
     * The filter list used to hand-write its own copy of these four strings,
     * so renaming them at the chokepoint left the filter offering "No ghost
     * signals" while every row beside it said something else. Deriving is the
     * fix; this asserts the derivation rather than the current wording, so a
     * FUTURE relabel — or a fifth badge value — cannot reintroduce the split.
     */
    it('every scored badge filters under the same label the row shows', () => {
        const scored = Object.entries(GHOST_META).filter(([, meta]) => meta !== null);
        assert.ok(scored.length > 0, 'GHOST_META has no scored values — the check would be vacuous');
        for (const [value, meta] of scored) {
            assert.equal(
                facetValueLabel('ghost_badge', value),
                meta!.label,
                `filter label for ${value} has drifted from the row badge`,
            );
        }
    });

    it('an unscored posting is still nameable in the filter', () => {
        // `unscored` has no row badge (nothing has been checked, so there is no
        // verdict to show), but it is still a thing you can filter to — it must
        // not fall through to the raw facet value.
        assert.equal(facetValueLabel('ghost_badge', 'unscored'), 'Not checked yet');
    });
});
