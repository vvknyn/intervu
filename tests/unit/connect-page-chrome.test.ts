import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONNECT_CLIENT = join(__dirname, "..", "..", "src", "app", "connect", "connect-client.tsx");

describe("connect page chrome guards", () => {
    // #421 (d254a782) replaced the chipVariants kicker/tab chips with a plain
    // eyebrow and the house Tabs primitive; the no-emerald-pill guard stays.
    it("uses house tokens and the Tabs primitive, not emerald pills", () => {
        const src = readFileSync(CONNECT_CLIENT, "utf8");
        assert.doesNotMatch(src, /rounded-full/);
        assert.doesNotMatch(src, /border-emerald/);
        assert.doesNotMatch(src, /emerald-/);
        assert.match(src, /from "@\/components\/ui\/tabs"/);
    });
});
