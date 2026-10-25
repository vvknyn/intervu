import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const GLOBALS_RAW = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

/** Comments are prose ABOUT the rules, not rules. An assertion that reads them
 *  passes on the strength of its own explanation: the first version of the
 *  touch-action guard below matched the phrase inside the comment describing
 *  it, so deleting the actual declaration left the test green. */
const GLOBALS = GLOBALS_RAW.replace(/\/\*[\s\S]*?\*\//g, "");

function tsxFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) tsxFiles(full, acc);
        else if (entry.endsWith(".tsx")) acc.push(full);
    }
    return acc;
}

/** A font-size utility with no responsive prefix — i.e. the one phones get. */
const SMALL_UNPREFIXED = /(?<![-:\w])text-(sm|xs)(?![-\w])|(?<![-:\w])text-\[(\d+(?:\.\d+)?)px\]/g;
/** Anything a keyboard opens onto. Deliberately matches component names as
 *  well as raw tags: the Select trigger renders as `SelectPrimitive.Trigger`,
 *  so a matcher built only from tag names skipped it entirely and the guard
 *  reported green while that control still zoomed.
 *
 *  Consuming the tag needs more care than `[^>]*?>`, which stops at the first
 *  `>` in the source — and in real JSX that `>` usually arrives long before
 *  `className` does, inside an inline handler (`onChange={(e) => …}`) or a
 *  Tailwind arbitrary variant (`[&>svg]:size-3`). That truncation is exactly
 *  how the /jobs search and location boxes — the two most-used inputs in the
 *  product — sat at 14px with this guard passing. So `=>` and quoted strings
 *  are consumed as units, and only a bare `>` ends the tag. */
const CONTROL =
    /<([A-Za-z.]*(?:Input|Textarea|Select[A-Za-z.]*Trigger)|input|textarea|select)\b(?:"[^"]*"|'[^']*'|=>|[^>])*?\/?>/g;

/** Any JSX element at all that takes a `placeholder`.
 *
 *  Matching control names is a list, and a list is only ever as complete as
 *  the last person to extend it: `SearchAutocomplete` — the main search box on
 *  /jobs, the single most-used input in the product — is not called Input, so
 *  a name-based matcher walked straight past it while it sat at 14px. A
 *  `placeholder` prop is a property of the THING (only a text entry has one),
 *  not of what someone chose to call it, so it keeps working for controls
 *  nobody has written yet.
 *
 *  Scanned as ONE quantified group and filtered in JS afterwards: expressing
 *  "…placeholder=… …className=…" as a single pattern needs two quantifiers
 *  around the same alternation, which backtracks exponentially and hung the
 *  suite outright. */
const ANY_JSX_TAG = /<[A-Za-z][A-Za-z.]*\b(?:"[^"]*"|'[^']*'|=>|[^>])*?\/?>/g;

/** The compact-width 16px floor in globals.css, as the rule that decides it:
 *  its selector and whether it sits at top level (unlayered). Unlayered is what
 *  makes it beat a `text-xs` utility on a raw <input>; moved into @layer it
 *  would lose to that utility and the page would zoom again. */
function compactFontFloor(): { selector: string; unlayered: boolean } | null {
    const m = /@media \(max-width: 1023px\) \{/.exec(GLOBALS);
    if (!m) return null;
    const depth = [...GLOBALS.slice(0, m.index)].reduce((d, c) => d + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);
    const rule = /(:where\([^{}]*?\))\s*\{\s*font-size:\s*max\(16px,\s*1em\);\s*\}/.exec(GLOBALS.slice(m.index));
    return rule ? { selector: rule[1], unlayered: depth === 0 } : null;
}

test("every native text-entry control computes 16px on a phone through one unlayered rule", () => {
    const floor = compactFontFloor();
    assert.ok(floor, "the `font-size: max(16px, 1em)` compact-width rule is gone from globals.css");
    assert.ok(floor.unlayered, "the 16px floor is inside an @layer, so a `text-xs` utility on a raw <input> beats it");
    for (const part of ["input:not(", "select", "textarea", "[contenteditable]"]) {
        assert.ok(floor.selector.includes(part), `the 16px floor no longer covers ${part}`);
    }
});

test("no form control renders below 16px on a phone", () => {
    // iOS Safari zooms the page when a FOCUSED form control computes under
    // 16px, and it does not zoom back out — the user is left scrolled
    // sideways mid-form. The primitives already encoded the fix
    // (`text-base md:text-sm`: 16px on phones, smaller from md up), but a call
    // site passing `text-sm` through `className` overrides it, and eight had
    // — including both auth forms, so the zoom landed on a password field
    // during sign-in.
    //
    // This asserts the CLASS: any control, anywhere, including ones not
    // written yet. The fix is never to delete the small size, it is to prefix
    // it — `text-base md:text-sm` keeps the desktop look exactly as it was.
    const offenders: string[] = [];
    for (const file of tsxFiles(path.join(ROOT, "src"))) {
        const src = readFileSync(file, "utf8");
        const withPlaceholder = (src.match(ANY_JSX_TAG) || []).filter((t) => /\bplaceholder=/.test(t));
        const tags = new Set([...(src.match(CONTROL) || []), ...withPlaceholder]);
        for (const tag of tags) {
            // A native input/select/textarea is held at 16px by the unlayered
            // compact-width floor asserted above, whatever size class it
            // carries; everything else (components, custom editors) must
            // prefix its own size.
            if (/^<(input|textarea|select)\b/.test(tag)) continue;
            // Three spellings, and the third is not optional: the primitives
            // compose their base class through `cn(...)`, so an extractor that
            // only understood `className="..."` read every primitive as having
            // no classes at all and passed them without looking.
            const cm = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([\s\S]*?)\)\s*\})/.exec(tag);
            const cls = cm?.[1] ?? cm?.[2] ?? cm?.[3];
            if (!cls) continue;
            for (const m of cls.matchAll(SMALL_UNPREFIXED)) {
                if (m[2] && Number(m[2]) >= 16) continue;
                const line = src.slice(0, src.indexOf(tag)).split("\n").length;
                offenders.push(`${path.relative(ROOT, file)}:${line} ${m[0]}`);
            }
        }
    }
    assert.deepEqual(
        offenders,
        [],
        `these zoom the page on focus in iOS Safari — prefix the size (text-base md:text-sm):\n${offenders.join("\n")}`,
    );
});

test("double-tap zoom is suppressed on controls, not on the page", () => {
    const rule = /touch-action:\s*manipulation/.test(GLOBALS);
    assert.ok(rule, "touch-action: manipulation is gone — double-tap zoom is back on controls");
});

test("pinch zoom is never taken away from the user", () => {
    // The tempting one-line "fix" for both behaviours is user-scalable=no /
    // maximum-scale=1 on the viewport. It fails WCAG 1.4.4, and iOS has
    // ignored it since iOS 10 — so it would break accessibility for people who
    // enlarge text WITHOUT even fixing the bug it was reached for. Anyone who
    // adds it later should trip this instead of shipping it.
    //
    // Scoped to the app's own pages: the transactional-email HTML in
    // src/lib/email is a different rendering context (mail clients), and its
    // viewport tags are not this rule's business.
    const offenders: string[] = [];
    for (const file of tsxFiles(path.join(ROOT, "src"))) {
        const src = readFileSync(file, "utf8");
        if (/user-scalable\s*[=:]\s*(no|0)|maximum-scale\s*[=:]\s*1|userScalable:\s*false|maximumScale:\s*1/.test(src)) {
            offenders.push(path.relative(ROOT, file));
        }
    }
    assert.deepEqual(offenders, [], `these disable pinch zoom (WCAG 1.4.4): ${offenders.join(", ")}`);
});
