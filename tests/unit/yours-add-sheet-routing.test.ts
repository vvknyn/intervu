import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const YOURS_PAGE = join(__dirname, "..", "..", "src", "app", "yours", "page.tsx");

function readYoursPage(): string {
    return readFileSync(YOURS_PAGE, "utf8");
}

function sliceHandler(src: string, name: "openAdd" | "closeAdd"): string {
    const match = src.match(new RegExp(`const ${name} = \\(\\) => \\{([\\s\\S]*?)\\n    \\};`));
    assert.ok(match, `expected ${name} handler on /yours page`);
    return match[1];
}

describe("yours add sheet routing — openAdd / closeAdd contract", () => {
    it("openAdd opens local state and soft-navigates with ?view=new (no scroll)", () => {
        const body = sliceHandler(readYoursPage(), "openAdd");
        assert.match(body, /setAddOpen\(true\)/);
        assert.match(body, /router\.replace\("\/yours\?view=new", \{ scroll: false \}\)/);
    });

    it("closeAdd clears local state and strips the view query via router.replace", () => {
        const body = sliceHandler(readYoursPage(), "closeAdd");
        assert.match(body, /setAddOpen\(false\)/);
        assert.match(body, /router\.replace\("\/yours", \{ scroll: false \}\)/);
    });

    it("TrackRoleSheet close path routes through closeAdd (not bare setState)", () => {
        const src = readYoursPage();
        assert.match(
            src,
            /TrackRoleSheet[\s\S]*onOpenChange=\{\(open\) => \(open \? openAdd\(\) : closeAdd\(\)\)\}/,
        );
    });

    it("stable header CTA invokes openAdd", () => {
        const src = readYoursPage();
        assert.match(
            src,
            /data-testid="tracker-track-role-cta"[\s\S]*onClick=\{openAdd\}/,
        );
    });
});
