import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AUTOCOMPLETE = join(__dirname, "..", "..", "src", "components", "search", "SearchAutocomplete.tsx");
const LOCATION = join(__dirname, "..", "..", "src", "components", "jobs", "LocationCombobox.tsx");
const MOBILE_TABBAR = join(__dirname, "..", "..", "src", "components", "layout", "MobileTabBar.tsx");

describe("loading UI patterns", () => {
    it("SearchAutocomplete shows a compact loading row during live suggest", () => {
        const src = readFileSync(AUTOCOMPLETE, "utf8");
        assert.match(src, /suggestLoading/);
        assert.match(src, /Loading suggestions/);
        assert.match(src, /role="status"/);
    });

    it("LocationCombobox shows a loading row while fetching locations", () => {
        const src = readFileSync(LOCATION, "utf8");
        assert.match(src, /fetching/);
        assert.match(src, /Loading locations/);
        assert.match(src, /role="status"/);
    });

    it("MobileTabBar renders Agents label from NAV_TABS", () => {
        const src = readFileSync(MOBILE_TABBAR, "utf8");
        assert.match(src, /tab\.shortLabel/);
        assert.doesNotMatch(src, />Connect</);
    });
});
