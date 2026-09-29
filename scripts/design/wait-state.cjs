// Pure detector behind tests/unit/wait-state-gate.test.ts: every skeleton,
// spinner and "Loading…" line in src/ goes through the one wait primitive
// (src/components/ui/wait-state.tsx — `WaitState`, `WaitBar`, `InlineSpinner`),
// which applies the timing ladder in src/lib/wait-state/ladder.ts. Escape
// hatch: a `wait-state-ok: <reason>` comment on the offending line or the line
// directly above it — no file list, the primitive included.
"use strict";
const { blankComments } = require("./control-scale.cjs");

// A hand-rolled wait: a spin/skeleton class, the old Skeleton primitive, the
// spinner glyph, or a bare "Loading…" that names nothing.
const RAW_WAIT = /animate-spin|skeleton-bar|<Skeleton\b|\bCircleNotch\b|\bLoading(?:…|\.\.\.)/g;

/** `[{ line (1-based), token }]` for every raw wait outside the primitive. */
function findRawWaits(raw) {
    const rawLines = raw.split("\n");
    const out = [];
    blankComments(raw).split("\n").forEach((line, i) => {
        if (/wait-state-ok:/.test(rawLines[i]) || (i > 0 && /wait-state-ok:/.test(rawLines[i - 1]))) return;
        for (const m of line.matchAll(RAW_WAIT)) out.push({ line: i + 1, token: m[0] });
    });
    return out;
}

module.exports = { findRawWaits };
