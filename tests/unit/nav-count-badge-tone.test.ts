import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { solidBadgeVariants } from "@/components/ui/badge";

/**
 * The nav ruling: the active-tab underline is the bar's one green accent. So a
 * count badge in the top bar or the phone tab bar is neutral (`tone="muted"`),
 * never the default brand fill. The gate scans every solid/count badge rendered
 * from the chrome (src/components/layout) and the bell, so a new nav badge
 * is covered without being named here.
 */
const ROOT = join(__dirname, "../..");
const CHROME_FILES = [
    ...readdirSync(join(ROOT, "src/components/layout"))
        .filter((f) => f.endsWith(".tsx"))
        .map((f) => join("src/components/layout", f)),
    "src/components/follows/FollowAlertsBell.tsx",
];
const BADGE_TAG = /<(?:CountBadge|SolidBadge)\b[^>]*>/g;

function luminance([r, g, b]: number[]): number {
    const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

describe("nav count badges are neutral", () => {
    const tags = CHROME_FILES.flatMap((f) =>
        (readFileSync(join(ROOT, f), "utf8").match(BADGE_TAG) ?? []).map((t) => ({ f, t })),
    );

    it("finds the bell badge (negative control: the scan can see a badge)", () => {
        assert.ok(tags.some((x) => x.t.includes("topbar-follow-alerts-count")));
    });

    it("every chrome badge passes tone=\"muted\"", () => {
        for (const { f, t } of tags) assert.match(t, /tone="muted"/, `${f}: ${t}`);
    });

    it("the muted tone has no brand fill", () => {
        const cls = solidBadgeVariants({ tone: "muted", size: "sm" });
        assert.doesNotMatch(cls, /bg-brand/);
        assert.match(solidBadgeVariants({ tone: "brand" }), /bg-brand/); // control: brand is the green one
    });

    it("muted badge text (foreground on chip) is at least 4.5:1 in every theme", () => {
        const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
        const grab = (name: string) =>
            [...css.matchAll(new RegExp(`^\\s*--${name}:\\s*(\\d+) (\\d+) (\\d+);`, "gm"))].map((m) => [+m[1], +m[2], +m[3]]);
        const fg = grab("foreground");
        const chip = grab("chip");
        assert.ok(fg.length > 0 && fg.length === chip.length, `foreground ${fg.length} vs chip ${chip.length}`);
        fg.forEach((f, i) => {
            const [a, b] = [luminance(f), luminance(chip[i])].sort((x, y) => y - x);
            assert.ok((a + 0.05) / (b + 0.05) >= 4.5, `theme ${i}: ${(a + 0.05) / (b + 0.05)}`);
        });
    });
});
