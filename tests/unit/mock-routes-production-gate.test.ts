import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(process.cwd(), "src/app/mock");
const LAYOUT = readFileSync(join(ROOT, "layout.tsx"), "utf8");

/** Every `page.tsx` under `src/app/mock/**` — design fixtures gated by mock/layout. */
function listMockRouteSegments(): string[] {
    const routes: string[] = [];
    function walk(dir: string, prefix: string) {
        for (const name of readdirSync(dir)) {
            const full = join(dir, name);
            const st = statSync(full);
            if (st.isDirectory()) {
                walk(full, prefix ? `${prefix}/${name}` : name);
            } else if (name === "page.tsx") {
                routes.push(prefix || "(root)");
            }
        }
    }
    walk(ROOT, "");
    return routes.sort();
}

function mockRoutesVisible(nodeEnv: string, mockRoutesEnabled: string | undefined): boolean {
    if (nodeEnv === "production" && mockRoutesEnabled !== "1") {
        return false;
    }
    return true;
}

describe("mock routes production gate", () => {
    it("mock/layout.tsx gates production unless MOCK_ROUTES_ENABLED=1", () => {
        assert.match(LAYOUT, /process\.env\.NODE_ENV === "production"/);
        assert.match(LAYOUT, /process\.env\.MOCK_ROUTES_ENABLED !== "1"/);
        assert.match(LAYOUT, /notFound\(\)/);
    });

    it("gate logic: production without flag hides mocks; development and flagged production show them", () => {
        assert.equal(mockRoutesVisible("production", undefined), false);
        assert.equal(mockRoutesVisible("production", "0"), false);
        assert.equal(mockRoutesVisible("production", "1"), true);
        assert.equal(mockRoutesVisible("development", undefined), true);
        assert.equal(mockRoutesVisible("test", undefined), true);
    });

    it("every mock page route lives under the gated mock layout (including for-you-deck)", () => {
        const routes = listMockRouteSegments();
        assert.ok(routes.includes("for-you-deck"), `expected for-you-deck in ${routes.join(", ")}`);
        assert.ok(routes.length >= 1, "at least one mock route");

        for (const segment of routes) {
            const pagePath = join(ROOT, segment === "(root)" ? "page.tsx" : join(segment, "page.tsx"));
            const page = readFileSync(pagePath, "utf8");
            assert.doesNotMatch(
                page,
                /notFound\(\)/,
                `${segment} must not bypass parent layout with its own notFound gate`,
            );
        }

        const nestedLayouts: string[] = [];
        function findNestedLayouts(dir: string, prefix: string) {
            for (const name of readdirSync(dir)) {
                const full = join(dir, name);
                if (!statSync(full).isDirectory()) continue;
                const rel = prefix ? `${prefix}/${name}` : name;
                const layoutPath = join(full, "layout.tsx");
                try {
                    statSync(layoutPath);
                    nestedLayouts.push(rel);
                } catch {
                    /* no layout */
                }
                findNestedLayouts(full, rel);
            }
        }
        findNestedLayouts(ROOT, "");
        assert.deepEqual(
            nestedLayouts,
            [],
            "nested mock layouts would bypass src/app/mock/layout.tsx production gate",
        );
    });
});
