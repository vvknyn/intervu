import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { DEFAULT_LOOK, LOOK_BOOT_SCRIPT, LOOK_STORAGE_KEY, parseLook } from "../../src/lib/ui/look";

const GLOBALS = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
const LAYOUT = readFileSync(new URL("../../src/app/layout.tsx", import.meta.url), "utf8");

/** Runs the boot script against a fake <html> + storage; returns the stamped look and what was stored. */
function boot(search: string, stored: string | null, storageThrows = false) {
    const attrs: Record<string, string> = {};
    const store: Record<string, string> = stored == null ? {} : { [LOOK_STORAGE_KEY]: stored };
    const localStorage = {
        getItem: (k: string) => {
            if (storageThrows) throw new Error("blocked");
            return k in store ? store[k] : null;
        },
        setItem: (k: string, v: string) => {
            if (storageThrows) throw new Error("blocked");
            store[k] = v;
        },
    };
    runInNewContext(LOOK_BOOT_SCRIPT, {
        document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
        location: { search },
        localStorage,
        URLSearchParams,
    });
    return { look: attrs["data-look"], stored: store[LOOK_STORAGE_KEY] ?? null };
}

test("the boot script stamps the default, the stored choice, and a ?look= override (which it remembers)", () => {
    assert.equal(DEFAULT_LOOK, "glass");
    assert.deepEqual(boot("", null), { look: "glass", stored: null });
    assert.deepEqual(boot("", "classic"), { look: "classic", stored: "classic" });
    assert.deepEqual(boot("?q=pm&look=classic", "glass"), { look: "classic", stored: "classic" });
    assert.deepEqual(boot("?look=glass", "classic"), { look: "glass", stored: "glass" });
    // Junk in either place falls back to the default, never to an unknown look.
    assert.deepEqual(boot("?look=neon", "sepia"), { look: "glass", stored: "sepia" });
    // Storage blocked (private mode): the query still wins, and nothing throws.
    assert.equal(boot("?look=classic", null, true).look, "classic");
    assert.equal(boot("", null, true).look, "glass");
});

test("parseLook accepts only the two looks", () => {
    assert.equal(parseLook("glass"), "glass");
    assert.equal(parseLook("classic"), "classic");
    assert.equal(parseLook("Glass"), null);
    assert.equal(parseLook(null), null);
});

test("layout.tsx stamps the look before paint and renders the default on <html>", () => {
    assert.match(LAYOUT, /data-look=\{DEFAULT_LOOK\}/);
    assert.match(LAYOUT, /dangerouslySetInnerHTML=\{\{ __html: LOOK_BOOT_SCRIPT \}\}/);
});

test("classic is the look before the glass: every glass rule in globals.css is keyed on data-look=glass", () => {
    const start = GLOBALS.indexOf("/* LOOK — the glass look");
    assert.ok(start >= 0, "the LOOK block is missing from globals.css");
    const end = GLOBALS.indexOf("/* State indicator drawn inside the box", start);
    const block = GLOBALS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
    // Top-level selectors (and the glass-* utilities' inner selectors) all carry the gate.
    const selectors = [...block.matchAll(/^([^\s@{}][^{]*)\{/gm)].map((m) => m[1].trim());
    assert.ok(selectors.length > 5, "no rules found in the LOOK block");
    for (const sel of selectors) {
        if (sel.startsWith("@")) continue;
        assert.match(sel, /data-look="glass"/, `ungated glass rule: ${sel}`);
    }
    for (const util of ["glass-surface", "glass-chip", "glass-selected"]) {
        const body = block.slice(block.indexOf(`@utility ${util} {`));
        assert.match(body.slice(0, body.indexOf("\n}\n")), /:root\[data-look="glass"\] &/, `${util} is not gated on the look`);
    }
    // The corner roles are runtime values the look moves, defaulting to the classic corners.
    assert.match(GLOBALS, /--ctl-radius: 12px;/);
    assert.match(GLOBALS, /--panel-radius: 16px;/);
    assert.match(GLOBALS, /--radius-ctl: var\(--ctl-radius\);/);
    assert.match(GLOBALS, /--radius-panel: var\(--panel-radius\);/);
});
