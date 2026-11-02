import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FactLine } from "@/components/ui/fact-line";

/**
 * The phone "wrapping" class (founder screenshot of /resume, 2026-11-01): a row of buttons left ragged by
 * `flex flex-wrap` ("Edit template / Replace", "Download .pdf / Download .json", "Delete" alone), a "·" ending a line
 * ("Technical Account Manager · 11 yrs exp ·"), and a footer link alone on its last line. The rendered pages are
 * measured by journey J-MOB-33/34 (phone-wrap.spec.ts); this file keeps a new row or a new joined line from being
 * written the old way in the first place.
 */

const SRC = join(process.cwd(), "src");

function tsxFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (path.includes(`${join("src", "app", "mock")}`) || path.endsWith(join("src", "components", "mock"))) continue;
            tsxFiles(path, out);
        } else if (entry.name.endsWith(".tsx")) out.push(path);
    }
    return out;
}

const FILES = tsxFiles(SRC).map((path) => ({ path, rel: path.slice(process.cwd().length + 1), src: readFileSync(path, "utf8") }));

/** Rows that keep `flex flex-wrap` around two or more <Button>s on purpose, and why. */
const WRAPPING_BUTTON_ROW_ALLOWED: Record<string, string> = {
    "src/app/error.tsx": "two centred buttons; both fit on one line at 320px",
    "src/components/jobs/ApplyReturnPrompt.tsx": "a toast: Yes and Not yet grow (flex-1) and Skip sits beside them on one line",
    "src/components/account/AccountEmailPrompt.tsx": "a field and its button: a form row, not a set of actions",
    "src/components/jobs/SearchAlertCapture.tsx": "a field and its button: a form row, not a set of actions",
    "src/components/settings/SettingsContainer.tsx": "flex-col on a phone with full-width buttons (one per line); it wraps only from sm up",
    "src/components/settings/YourResumeSection.tsx": "the buttons sit in a nested .action-row; this flex-wrap only sets the 'Last updated' note beside it from sm up",
};

/** Source lines from `start` to the close of the element that opens there (by indentation). */
function elementBlock(lines: string[], start: number): string {
    const indent = lines[start].match(/^\s*/)![0].length;
    const block = [lines[start]];
    for (let j = start + 1; j < lines.length && j < start + 80; j++) {
        block.push(lines[j]);
        if ((lines[j].match(/^\s*/)![0].length ?? 0) <= indent && /^\s*<\/(div|nav|ul|p|section|footer|form)>/.test(lines[j])) break;
    }
    return block.join("\n");
}

describe("a row of buttons wraps as an .action-row, not a bare flex-wrap", () => {
    it("no flex-wrap row holds two or more <Button>s unless it is listed with a reason", () => {
        const offenders: string[] = [];
        for (const { rel, src } of FILES) {
            if (rel in WRAPPING_BUTTON_ROW_ALLOWED) continue;
            const lines = src.split("\n");
            lines.forEach((line, i) => {
                const opensRow = /className=/.test(line) && /\bflex-wrap\b/.test(line);
                const classOnNextLine = /\bflex-wrap\b/.test(line) && /className/.test(lines[i - 1] ?? "");
                if (!opensRow && !classOnNextLine) return;
                if ((elementBlock(lines, i).match(/<Button\b/g) ?? []).length >= 2) offenders.push(`${rel}:${i + 1}`);
            });
        }
        assert.deepEqual(
            offenders,
            [],
            "a row of buttons on a phone is `action-row` (globals.css): every line runs edge to edge. A bare flex-wrap left Delete alone and off-centre on /resume. If a row truly should not be one, list the file in WRAPPING_BUTTON_ROW_ALLOWED with the reason.",
        );
    });

    it("the allowlist names only files that still exist and still hold a wrapping row", () => {
        for (const rel of Object.keys(WRAPPING_BUTTON_ROW_ALLOWED)) {
            const file = FILES.find((f) => f.rel === rel);
            assert.ok(file, `${rel} is listed but gone`);
            assert.match(file.src, /\bflex-wrap\b/, `${rel} no longer wraps a row: drop it from the list`);
        }
    });

    it("the button rows that were ragged are .action-row now", () => {
        for (const rel of [
            "src/components/settings/YourResumeSection.tsx",
            "src/app/resume/page.tsx",
            "src/app/yours/[id]/page.tsx",
            "src/components/auth/SignupGate.tsx",
            "src/components/jobs/LocalCustomizePanel.tsx",
            "src/components/jobs/for-you/ResumePlaceConfirm.tsx",
            "src/components/tracker/PursuitDetailSheet.tsx",
            "src/components/tracker/TrackRoleSheet.tsx",
        ]) {
            assert.match(FILES.find((f) => f.rel === rel)!.src, /className="action-row[ "]/, rel);
        }
    });
});

describe("the primitives exist in globals.css", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");

    it(".action-row fills each wrapped line below sm and is the ordinary wrapping row from sm up", () => {
        assert.match(css, /\.action-row\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
        assert.match(css, /@media \(max-width: 639\.98px\)\s*\{\s*\.action-row > \* \{\s*flex:\s*1 1 var\(--action-row-min\);/);
    });

    it(".fact-line hangs the dot strip of a line's first fact outside a clipped row", () => {
        assert.match(css, /\.fact-line\s*\{[^}]*overflow-x:\s*clip;/);
        assert.match(css, /\.fact-line > \*\s*\{[^}]*margin-inline:\s*-1em 1em;[^}]*padding-inline-start:\s*1em;/);
        assert.match(css, /\.fact-line > :not\(:first-child\)::before\s*\{[^}]*content:\s*"·";/);
    });

    it(".link-cloud is columns below sm and a wrapping line from sm up", () => {
        assert.match(css, /\.link-cloud\s*\{[^}]*display:\s*grid;[^}]*repeat\(auto-fill, minmax\(8\.5rem, 1fr\)\)/);
        assert.match(css, /@media \(min-width: 640px\)\s*\{\s*\.link-cloud\s*\{\s*display:\s*flex;\s*flex-wrap:\s*wrap;/);
    });

    it("the footer's link runs are .link-cloud, not flex-wrap", () => {
        const footer = FILES.find((f) => f.rel === "src/components/layout/Footer.tsx")!.src;
        assert.equal((footer.match(/link-cloud/g) ?? []).length, 2);
        assert.doesNotMatch(footer, /flex-wrap/);
    });
});

describe("FactLine", () => {
    it("renders each fact as its own item and no dot as text", () => {
        const html = renderToStaticMarkup(FactLine({ items: ["Technical Account Manager", "11 yrs exp", "Richmond Hill, Ontario"] }));
        assert.match(html, /^<p class="fact-line"><span>Technical Account Manager<\/span><span>11 yrs exp<\/span><span>Richmond Hill, Ontario<\/span><\/p>$/);
        assert.ok(!html.includes("·"), "the dots are CSS, so they can never end a line as text");
    });

    it("drops absent facts and renders nothing when none is left", () => {
        assert.match(renderToStaticMarkup(FactLine({ items: [false, "a", null, undefined, "", "b"] })), /<span>a<\/span><span>b<\/span>/);
        assert.equal(renderToStaticMarkup(FactLine({ items: [false, null, undefined, ""] })), "");
    });

    it("keeps its class, a caller's class and a test id", () => {
        const html = renderToStaticMarkup(FactLine({ items: ["a", "b"], className: "text-xs", "data-testid": "x" }));
        assert.match(html, /class="fact-line text-xs"/);
        assert.match(html, /data-testid="x"/);
    });
});

/** Where a "·" is still joined into rendered text by hand, and why that is fine. */
const HAND_JOINED_DOT_ALLOWED: Record<string, string> = {
    "src/components/jobs/JobCard.tsx": "a title attribute (the row's tooltip), not rendered text",
    "src/components/jobs/TailorChangeList.tsx": "one short heading: role · company",
    "src/components/trends/MarketPulse.tsx": "a run of sources after a bold label, inside one paragraph",
    "src/components/company/CompanyFactRow.tsx": "one cell's value: two short phrases",
    "src/components/jobs/HiresIn.tsx": "a sentence: the hiring note, then the posting's own quote",
    "src/components/jobs/for-you/RecommendedListNotes.tsx": "a notice, then its action link, in one sentence",
    "src/app/blog/[slug]/page.tsx": "the eyebrow: Blog · date, two short words",
};

describe("a line of facts is a <FactLine>, not text joined with a dot", () => {
    it("no file joins facts with ' · ' into rendered text unless it is listed with a reason", () => {
        const offenders = FILES.filter(({ rel, src }) => !(rel in HAND_JOINED_DOT_ALLOWED) && (/\.join\(" · "\)/.test(src) || /\{" · "\}/.test(src))).map((f) => f.rel);
        assert.deepEqual(
            offenders,
            [],
            "text joined with ' · ' ends a wrapped line on a dot (the /resume headline). Put the facts in <FactLine items={[…]}/> (ui/fact-line.tsx), or list the file in HAND_JOINED_DOT_ALLOWED with the reason.",
        );
    });

    it("the allowlist names only files that still join with a dot", () => {
        for (const rel of Object.keys(HAND_JOINED_DOT_ALLOWED)) {
            const file = FILES.find((f) => f.rel === rel);
            assert.ok(file, `${rel} is listed but gone`);
            assert.ok(/\.join\(" · "\)/.test(file.src) || /\{" · "\}/.test(file.src), `${rel} no longer joins with a dot: drop it from the list`);
        }
    });

    it("the résumé readout puts its headline and contact lines through FactLine", () => {
        const readout = FILES.find((f) => f.rel === "src/components/resume-builder/GuestResumeReadout.tsx")!.src;
        assert.equal((readout.match(/<FactLine/g) ?? []).length, 2);
        assert.doesNotMatch(readout, /\.join\(" · "\)/);
    });
});
