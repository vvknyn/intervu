import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    FONT_RENDER_HINTING_NONE,
    linuxChromiumVisualQaArgs,
    linuxChromiumVisualQaLaunchOptions,
} from "../../scripts/design/linux-chromium-visual-qa.cjs";

const ROOT = join(__dirname, "../..");

describe("linux Chromium visual QA launch helper", () => {
    it("documents the no-hint flag constant", () => {
        assert.equal(FONT_RENDER_HINTING_NONE, "--font-render-hinting=none");
    });

    it("adds the flag on Linux only", () => {
        if (process.platform === "linux") {
            assert.deepEqual(linuxChromiumVisualQaArgs(), ["--font-render-hinting=none"]);
            assert.ok(
                linuxChromiumVisualQaLaunchOptions({ args: ["--disable-dev-shm-usage"] }).args?.includes(
                    "--font-render-hinting=none",
                ),
            );
        } else {
            assert.deepEqual(linuxChromiumVisualQaArgs(), []);
        }
    });

    it("Playwright config wires Linux visual QA launch options for Chromium projects", () => {
        const cfg = readFileSync(join(ROOT, "playwright.config.ts"), "utf8");
        assert.match(cfg, /linuxChromiumVisualQaLaunchOptions/);
        assert.match(cfg, /scripts\/design\/linux-chromium-visual-qa\.cjs/);
    });

    it("signed-in gate walk screenshots use the shared launch helper", () => {
        const gate = readFileSync(join(ROOT, "scripts/gate-walk-signed-in.mjs"), "utf8");
        assert.match(gate, /linuxChromiumVisualQaLaunchOptions/);
    });
});
