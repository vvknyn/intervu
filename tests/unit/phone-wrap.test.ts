import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { FactLine } from "@/components/ui/fact-line";
import { BLOG_POSTS } from "@/lib/blog/posts";
import { getAllCareerHubSlugs } from "@/lib/seo/career-hubs";
import { SAMPLE_BLOG_SLUG, SAMPLE_CAREER_SLUG, WRAP_FIXTURE_READY, WRAP_ROUTES, auditedPaths, isFixture } from "../e2e/helpers/wrap-routes";

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

describe("an email capture form is a .form-stack: one column at every width", () => {
    const css = readFileSync(join(SRC, "app", "globals.css"), "utf8");
    const src = (rel: string) => FILES.find((f) => f.rel === rel)!.src;

    it(".form-stack is a stretched column", () => {
        assert.match(css, /\.form-stack\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/);
    });

    it("no <form> in src is a wrapping flex row (the Job alert panel put its button beside the widget and \"Not now\" alone)", () => {
        const offenders: string[] = [];
        for (const { rel, src: text } of FILES) {
            const lines = text.split("\n");
            lines.forEach((line, i) => {
                if (/<form\b/.test(line) && /\bflex-wrap\b/.test(lines.slice(i, i + 4).join("\n").split(/>\s*$/m)[0])) offenders.push(`${rel}:${i + 1}`);
            });
        }
        assert.deepEqual(
            offenders,
            [],
            "a form is `form-stack` (globals.css): the field, the security check and the buttons each on a line of their own. A `flex flex-wrap` form put the Job alert button beside Turnstile's fixed 300x65 box (founder screenshot 2026-11-08).",
        );
    });

    it("the Job alert form and both account-email forms are form-stacks whose field is not capped, with their buttons in an .action-row", () => {
        const alert = src("src/components/jobs/SearchAlertCapture.tsx");
        const prompt = src("src/components/account/AccountEmailPrompt.tsx");
        assert.equal((alert.match(/<form [^\n]*form-stack/g) ?? []).length, 1);
        assert.equal((prompt.match(/<form [^\n]*form-stack/g) ?? []).length, 2);
        assert.equal((alert.match(/className="action-row"/g) ?? []).length, 1);
        assert.equal((prompt.match(/className="action-row"/g) ?? []).length, 2);
        for (const file of [alert, prompt]) {
            assert.doesNotMatch(file, /max-w-\[260px\]/, "cap the form (max-w-md), never the field");
            assert.doesNotMatch(file, /flex-wrap/);
        }
        assert.match(alert, /<TurnstileWidget [^\n]*className="justify-start"/);
    });

    it("the security check's slot is a full-width box of its own and has a test id", () => {
        const widget = src("src/components/ui/turnstile-widget.tsx");
        assert.match(widget, /data-testid="turnstile-slot" className=\{cn\('flex w-full justify-center', className\)\}/);
    });

    it("both forms are audited through their /mock fixtures, which the layout journey measures at 1180, 768, 390 and 320", () => {
        const jobs = WRAP_ROUTES["/jobs"];
        assert.ok("audit" in jobs && jobs.audit.includes("/mock/search-alert") && jobs.audit.includes("/mock/email-nudge"));
        assert.ok(readFileSync(join(process.cwd(), "src/app/mock/search-alert/page.tsx"), "utf8").includes("<SearchAlertMock"));
        assert.ok(src("src/app/jobs/JobsContent.tsx").includes("SearchAlertCapture"), "the real page renders the component the fixture renders");
        assert.match(readFileSync(join(process.cwd(), "tests/e2e/journeys/form-stack.spec.ts"), "utf8"), /@J-ALERTS-49/);
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

describe("runs of plain items are .link-cloud or FactLine, on the pages that draw them only when their data answers", () => {
    const src = (rel: string) => FILES.find((f) => f.rel === rel)!.src;

    it("/trends: the employment-type links and the workplace legend are link clouds, the sources line is a FactLine", () => {
        const experience = src("src/components/trends/ExperienceSeniorityDistribution.tsx");
        const work = src("src/components/trends/WorkArrangementDistribution.tsx");
        const pulse = src("src/components/trends/MarketPulse.tsx");
        assert.match(experience, /className="link-cloud mt-2\.5"/);
        assert.match(work, /<ul className="link-cloud mt-2 mb-4"/);
        assert.doesNotMatch(experience, /flex-wrap/);
        assert.doesNotMatch(work, /flex-wrap/);
        assert.match(pulse, /<FactLine\s+items=\{sourceCoverage/);
        assert.doesNotMatch(pulse, /\.join\(" · "\)/);
    });

    it("the career hubs: the topic links and the company links are link clouds, a role's facts are a FactLine", () => {
        const body = src("src/components/seo/CareerHubBody.tsx");
        const sections = src("src/components/seo/HubSections.tsx");
        assert.match(body, /<nav aria-label="Related career topics" className="link-cloud /);
        assert.match(sections, /<ul className="link-cloud mt-2 text-sm">/);
        assert.match(sections, /<FactLine items=\{\[displayCompanyName\(job\.company\), place, age\]\} \/>/);
        for (const file of [body, sections]) assert.doesNotMatch(file, /flex-wrap/);
    });

    it("both pages draw their body from a component the /mock fixture renders too", () => {
        assert.match(src("src/app/trends/page.tsx"), /<TrendsPageBody /);
        assert.match(readFileSync(join(process.cwd(), "src/app/mock/trends/page.tsx"), "utf8"), /<TrendsPageBody /);
        assert.match(src("src/app/careers/[slug]/page.tsx"), /<CareerHubBody /);
        assert.match(readFileSync(join(process.cwd(), "src/app/mock/career-hub/page.tsx"), "utf8"), /<CareerHubBody /);
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

/** Page routes under src/app, as URL patterns (`/careers/[slug]`), without the /mock design fixtures. */
function pageRoutes(dir = join(SRC, "app"), prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            if (entry.name === "page.tsx") out.push(prefix || "/");
            continue;
        }
        if (prefix === "" && entry.name === "mock") continue;
        const segment = /^\(.*\)$/.test(entry.name) ? "" : `/${entry.name}`;
        out.push(...pageRoutes(join(dir, entry.name), prefix + segment));
    }
    return out;
}

describe("every page route is audited for phone wrapping, or skipped with a reason", () => {
    it("WRAP_ROUTES lists exactly the page routes under src/app", () => {
        assert.deepEqual(Object.keys(WRAP_ROUTES).sort(), [...new Set(pageRoutes())].sort(), "a new page route must be added to tests/e2e/helpers/wrap-routes.ts (audited, or skipped with a reason), and a removed one dropped");
    });

    it("a skipped route says why, and an audited one names at least one path", () => {
        for (const [route, entry] of Object.entries(WRAP_ROUTES)) {
            if ("skip" in entry) assert.ok(entry.skip.trim().length >= 15, `${route}: say why it is skipped`);
            else assert.ok(entry.audit.length > 0 && entry.audit.every((p) => p.startsWith("/")), `${route}: name the paths asked`);
        }
    });

    it("every fixture asked has its mock page, and each section a fixture must draw exists in source", () => {
        const sources = FILES.map((f) => f.src).concat(tsxFilesIncludingMock().map((path) => readFileSync(path, "utf8"))).join("\n");
        for (const path of auditedPaths().filter(isFixture)) {
            assert.ok(tsxFilesIncludingMock().some((file) => file.endsWith(join(...path.split("/").filter(Boolean), "page.tsx"))), `${path} has no page under src/app`);
            for (const id of WRAP_FIXTURE_READY[path] ?? []) assert.ok(sources.includes(id) || sources.includes(`${id.slice(0, id.lastIndexOf("-") + 1)}\${`), `${path} waits for ${id}, which no source draws`);
        }
        for (const path of Object.keys(WRAP_FIXTURE_READY)) assert.ok(auditedPaths().includes(path), `${path} is waited for but never asked`);
    });

    it("the sample slugs are still real", () => {
        assert.ok(BLOG_POSTS.some((post) => post.slug === SAMPLE_BLOG_SLUG), `no blog post ${SAMPLE_BLOG_SLUG}`);
        assert.ok(getAllCareerHubSlugs().includes(SAMPLE_CAREER_SLUG), `no career hub ${SAMPLE_CAREER_SLUG}`);
    });
});

function tsxFilesIncludingMock(dir = SRC, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) tsxFilesIncludingMock(path, out);
        else if (entry.name.endsWith(".tsx")) out.push(path);
    }
    return out;
}
