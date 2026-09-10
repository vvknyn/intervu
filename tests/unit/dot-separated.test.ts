import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { DotSeparated } from "@/components/ui/dot-separated";

// Must match SEPARATOR in dot-separated.tsx: nbsp + middot + plain space.
const NBSP_DOT_SPACE = " · ";
// The two-break-point shape (plain space before the dot) that reproduces
// the leading-dot bug this component replaces.
const PLAIN_SPACE_DOT = " ·";

describe("DotSeparated", () => {
    it("glues a no-break space before every dot, with the only breakable space after it", () => {
        const html = renderToStaticMarkup(DotSeparated({ items: ["a", "b", "c"] }));
        assert.equal(html.split(NBSP_DOT_SPACE).length - 1, 2, "three items need exactly two nbsp-glued dots");
        assert.ok(!html.includes(PLAIN_SPACE_DOT), "the dot must never be preceded by a plain breakable space");
    });

    it("renders no dot for a single item", () => {
        const html = renderToStaticMarkup(DotSeparated({ items: ["only"] }));
        assert.ok(!html.includes("·"));
        assert.match(html, />only</);
    });

    it("drops falsy items (a case other than the motivating multi-item list)", () => {
        const html = renderToStaticMarkup(DotSeparated({ items: [false, "x", null, undefined, "y", ""] }));
        assert.equal(html.split(NBSP_DOT_SPACE).length - 1, 1, "only x and y are visible, so exactly one dot");
        assert.match(html, />x</);
        assert.match(html, />y</);
    });

    it("renders nothing when every item is falsy", () => {
        const html = renderToStaticMarkup(DotSeparated({ items: [false, null, undefined, ""] }));
        assert.equal(html, "");
    });

    it("never renders a flex class — the mechanism this component replaces", () => {
        const html = renderToStaticMarkup(DotSeparated({ items: ["a", "b"], className: "text-sm text-muted-foreground" }));
        const classAttrs = [...html.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
        assert.ok(classAttrs.length > 0, "expected at least one class attribute to inspect");
        for (const cls of classAttrs) {
            assert.ok(!/\bflex\b/.test(cls), `rendered class "${cls}" must not include flex/flex-wrap — that's what lets a dot lead a wrapped line`);
        }
    });
});

describe("dot separators do not sit as a flex-wrap item's leading child", () => {
    const FIXED_FILES = [
        join(__dirname, "..", "..", "src", "app", "co", "[slug]", "page.tsx"),
        join(__dirname, "..", "..", "src", "app", "yours", "history", "page.tsx"),
        join(__dirname, "..", "..", "src", "components", "tracker", "PursuitListRow.tsx"),
        join(__dirname, "..", "..", "src", "components", "jobs", "CompanyIntelStrip.tsx"),
        join(__dirname, "..", "..", "src", "components", "jobs", "JobDetailDocument.tsx"),
    ];

    for (const file of FIXED_FILES) {
        it(`${file.split("/").slice(-2).join("/")} has no flex-wrap container still holding a bare middot span`, () => {
            const src = readFileSync(file, "utf8");
            // A bare `>·<` (not the nbsp-glued separator) is the shape
            // that lands at the start of a wrapped line inside flex-wrap.
            assert.doesNotMatch(src, />·</, "a bare middot span must not remain in a flex-wrap container");
        });
    }
});
