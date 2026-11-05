/**
 * HIG Buttons / Accessibility: a 44x44pt hit region. On a coarse pointer every link and button carries its 44pt floor
 * as a ::before drawn around it (globals.css, "hit-area floor"). A control that clips its own overflow
 * (`line-clamp-*`, `truncate`, `overflow-hidden`, `text-ellipsis`) also clips that ::before to its own box, so a
 * one-line job title was 22pt tall to a finger (J-HIG-01 on /jobs with rows, found by the release gate 2026-11-05).
 * The clip goes on an inner span instead.
 *
 * Measured 2026-11-05: 5 links and buttons clipped themselves (the /jobs row title, the job page's company domain,
 * saved-search names, "More at this employer" titles, followed companies); 0 after.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function tsxFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(join(ROOT, dir))) {
        const rel = join(dir, name);
        if (statSync(join(ROOT, rel)).isDirectory()) out.push(...tsxFiles(rel));
        else if (rel.endsWith(".tsx")) out.push(rel);
    }
    return out;
}

/** The source with comments blanked (same length, so offsets and line numbers hold): a comment's quote or backtick
 *  must not be read as the start of a string. */
function withoutComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/^(\s*)\/\/.*$/gm, (_m, lead: string) => lead);
}

/** The opening tag that starts at `from`: up to the first ">" outside braces and strings. */
function openingTag(src: string, from: number): string {
    let depth = 0;
    let quote = "";
    for (let i = from; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
        else if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0) return src.slice(from, i + 1);
    }
    return src.slice(from);
}

const CLIP = /^(?:[a-z-]+:)*(?:line-clamp-\d+|truncate|overflow-hidden|text-ellipsis)$/;

/** Every link or button in `src` whose own className clips its overflow, as "line: tokens". */
export function selfClippingControls(source: string): string[] {
    const src = withoutComments(source);
    const out: string[] = [];
    for (const m of src.matchAll(/<(Link|a|button)\b/g)) {
        const tag = openingTag(src, m.index ?? 0);
        const cls = /className=("[^"]*"|\{[\s\S]*\})/.exec(tag);
        if (!cls) continue;
        const tokens = [...cls[1].matchAll(/"([^"]*)"/g)].flatMap((s) => s[1].split(/\s+/));
        const clip = tokens.filter((t) => CLIP.test(t));
        if (clip.length) out.push(`${src.slice(0, m.index).split("\n").length}: <${m[1]}> ${clip.join(" ")}`);
    }
    return out;
}

describe("a link or button never clips its own 44pt tap floor", () => {
    it("no link or button in src clips its own overflow: the clamp or truncate is on an inner span", () => {
        const offenders: string[] = [];
        for (const f of tsxFiles("src").filter((f) => !f.includes("/mock/"))) {
            for (const hit of selfClippingControls(readFileSync(join(ROOT, f), "utf8"))) offenders.push(`${f}:${hit}`);
        }
        assert.deepEqual(offenders, [], "move line-clamp/truncate/overflow-hidden to a <span> inside the control");
    });

    it("classifier: catches a self-clamped link (also behind a comment with a backtick), passes a clamped inner span", () => {
        assert.equal(selfClippingControls('<Link href="/a" className="text-base line-clamp-2">x</Link>').length, 1);
        assert.equal(selfClippingControls('<button className={cn("max-w-40", on && "truncate")}>x</button>').length, 1);
        assert.equal(
            selfClippingControls('<Link\n  className={cn(\n    // the `active` row\n    "max-sm:line-clamp-3",\n  )}\n  onClick={() => go()}\n>x</Link>').length,
            1,
        );
        assert.deepEqual(selfClippingControls('<Link href="/a" className="block name-link"><span className="line-clamp-2">x</span></Link>'), []);
        assert.deepEqual(selfClippingControls('<div className="truncate"><a href="/a">x</a></div>'), []);
    });
});
