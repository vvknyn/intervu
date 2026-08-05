/**
 * Finds the Chrome tab the OpenClaw agent is driving.
 *
 * OpenClaw runs a real (headed) Chrome with the DevTools Protocol on
 * 127.0.0.1:18800 — verified against the live install, not assumed.
 * `/json/list` returns targets most-recently-activated first, which is why
 * taking the first page is the same as taking the tab the agent just acted
 * on. That choice matters: the skill runs a two-tab protocol (form tab plus
 * resume tab), so "the active one" is the only rule that always shows the
 * thing being worked on.
 */

/** Base URL of Chrome's debug port. Overridable so tests never need a browser. */
export const DEFAULT_CDP_BASE = "http://127.0.0.1:18800";

export async function listPageTargets(cdpBase = DEFAULT_CDP_BASE, fetchImpl = fetch) {
    let res;
    try {
        res = await fetchImpl(`${cdpBase}/json/list`);
    } catch (cause) {
        throw new Error(
            `Cannot reach Chrome's debug port at ${cdpBase} — is OpenClaw's browser running? (openclaw browser status)`,
            { cause },
        );
    }
    if (!res.ok) {
        throw new Error(`Chrome's debug port at ${cdpBase} answered HTTP ${res.status}`);
    }
    const targets = await res.json();
    return targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

export function pickActiveTarget(targets) {
    return targets[0] ?? null;
}
