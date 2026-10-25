/**
 * Class guard: a Tailwind v4 colour utility whose theme token does not exist
 * generates NO css, so the element silently loses the colour (the selected job
 * row's `bg-brand-tint-bg` computed rgba(0,0,0,0) for exactly this reason).
 * Asks Tailwind's own design system whether each colour-utility candidate found
 * in src string literals produces css. No allow-list of names.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';

const ROOT = join(__dirname, '../..');
const PREFIXES =
    'bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|placeholder|shadow';
// [variant:]*[!][-]prefix-name[/opacity]; arbitrary values `[…]` are skipped by the character class.
const CANDIDATE = new RegExp(`^(?:[a-z0-9-]+:)*!?(?:${PREFIXES})-[a-z0-9][a-z0-9.-]*(?:/[0-9.]+)?$`);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return sourceFiles(p);
        return /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
    });
}

const COMMENTS = /\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/[^\n]*/g;
// A class list never has capitals or sentence punctuation; a literal that does is prose.
const PROSE_TOKEN = /[A-Z]|[.,;:!?)(]$/;
// Not class lists: `=== "x"` comparisons and `"a" | "b"` type unions.
const LITERAL = /(?<![=!]==?\s*|\|\s*)(["'`])((?:\\.|(?!\1)[^\\\n])*)\1(?!\s*\|)/g;

/** Class-like tokens of every string literal outside comments, with their 1-based line. */
export function candidatesIn(source: string): { token: string; line: number }[] {
    const code = source.replace(COMMENTS, (c) => c.replace(/[^\n]/g, ' '));
    const out: { token: string; line: number }[] = [];
    for (const m of code.matchAll(LITERAL)) {
        const tokens = m[2].split(/\s+/);
        if (tokens.some((t) => PROSE_TOKEN.test(t))) continue;
        const line = code.slice(0, m.index).split('\n').length;
        for (const token of tokens) if (CANDIDATE.test(token)) out.push({ token, line });
    }
    return out;
}

describe('every colour utility in src names a theme token', () => {
    it('candidatesIn skips arbitrary values and plain words', () => {
        assert.deepEqual(candidatesIn(`"bg-[#fff] hover:bg-surface text-left foo"`).map((c) => c.token), ['hover:bg-surface', 'text-left']);
        assert.deepEqual(candidatesIn('x === \"text-only\"; // bg-nope\ntype T = \"a\" | \"text-only\" | \"b\";\n\"Add to-do items, now.\"'), []);
    });

    it('generates css for each candidate', async () => {
        const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');
        const ds = await __unstable__loadDesignSystem(css, { base: join(ROOT, 'src/app') });
        const where = new Map<string, string>();
        for (const file of sourceFiles(join(ROOT, 'src'))) {
            for (const { token, line } of candidatesIn(readFileSync(file, 'utf8'))) {
                if (!where.has(token)) where.set(token, `${file.slice(ROOT.length + 1)}:${line}`);
            }
        }
        const names = [...where.keys()];
        const generated = ds.candidatesToCss(names);
        const dead = names.filter((_, i) => generated[i] === null).map((c) => `${c} (${where.get(c)})`);
        assert.deepEqual(dead, [], `colour utilities with no theme token:\n${dead.join('\n')}`);
    });
});
