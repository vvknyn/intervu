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
// Prose is decided per token, never per literal: a capitalised token (`Add`, a `[&_.Foo]` variant) or a
// bare `?`/`:` (a ternary) is ignored alone and its literal's other tokens are still checked. A word with
// sentence punctuation after it (`items,`) marks the literal as a sentence; its tokens are then judged one
// by one (punctuation stripped), never skipped whole, so a class named inside a sentence is still checked.
const PROSE_TOKEN = /[A-Z]|[.,;:!?)(]$/;
const SENTENCE_WORD = /\w[.,;:!?]$/;
const TRAILING_PUNCT = /[.,;:!?)]+$/;
// In a sentence these prefixes are also everyday words (`to-do`, `from-scratch`, `text-only`, `border-less`),
// so a bare `prefix-word` there proves nothing. A variant, `!`, or /opacity still marks a token as a class.
const PROSE_AMBIGUOUS = /^(?:to|from|via|text|border|shadow)-[a-z0-9.-]*$/;
// Not class lists: `=== "x"` comparisons and `"a" | "b"` type unions.
const LITERAL = /(?<![=!]==?\s*|\|\s*)(["'`])((?:\\.|(?!\1)[^\\\n])*)\1(?!\s*\|)/g;

/** Class-like tokens of every string literal outside comments, with their 1-based line. */
export function candidatesIn(source: string): { token: string; line: number }[] {
    const code = source.replace(COMMENTS, (c) => c.replace(/[^\n]/g, ' '));
    const out: { token: string; line: number }[] = [];
    for (const m of code.matchAll(LITERAL)) {
        const tokens = m[2].split(/[\s"'`]+/);
        const sentence = tokens.some((t) => SENTENCE_WORD.test(t));
        const line = code.slice(0, m.index).split('\n').length;
        for (const raw of tokens) {
            const token = sentence ? raw.replace(TRAILING_PUNCT, '') : raw;
            if (sentence ? /[A-Z(]/.test(token) || PROSE_AMBIGUOUS.test(token) : PROSE_TOKEN.test(token)) continue;
            if (CANDIDATE.test(token)) out.push({ token, line });
        }
    }
    return out;
}

describe('every colour utility in src names a theme token', () => {
    it('candidatesIn skips arbitrary values and plain words', () => {
        assert.deepEqual(candidatesIn('`bg-x ${open ? "bg-a" : "p-2"}` "Foo bg-y [&_.Bar]:p-1"').map((c) => c.token), ['bg-x', 'bg-a', 'bg-y']);
        assert.deepEqual(candidatesIn(`"bg-[#fff] hover:bg-surface text-left foo"`).map((c) => c.token), ['hover:bg-surface', 'text-left']);
        assert.deepEqual(candidatesIn('x === \"text-only\"; // bg-nope\ntype T = \"a\" | \"text-only\" | \"b\";\n\"Add to-do items, now.\"'), []);
        assert.deepEqual(
            candidatesIn('"Saved, then the row turns bg-zzplantc-fake." "Note: row tint is bg-zzplantc-fake when selected" "Use bg-zzplantc-fake, then retry; also hover:text-zzplantc-fake/50." "Add to-do items, text-only."').map((c) => c.token),
            ['bg-zzplantc-fake', 'bg-zzplantc-fake', 'bg-zzplantc-fake', 'hover:text-zzplantc-fake/50'],
        );
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
