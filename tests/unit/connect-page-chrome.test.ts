import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONNECT_CLIENT = join(__dirname, "..", "..", "src", "app", "connect", "connect-client.tsx");

describe("connect page chrome guards", () => {
    it("uses house chip variants and brand tokens, not emerald pills", () => {
        const src = readFileSync(CONNECT_CLIENT, "utf8");
        assert.doesNotMatch(src, /rounded-full/);
        assert.doesNotMatch(src, /border-emerald/);
        assert.doesNotMatch(src, /emerald-/);
        assert.match(src, /chipVariants/);
        assert.match(src, /chipVariants\(\{ active: true \}\)/);
    });
});
