/**
 * Soft-fail for employer apply URLs — demote known-dead links without
 * blocking the apply gesture on uncertain network failures.
 *
 * Storage: sessionStorage set of apply URLs that recently returned 404/410.
 * Checked on open; probe is best-effort HEAD/GET (no-cors opaque counts as ok).
 */

const DEAD_KEY = "intervu.apply-url-dead.v1";
const DEAD_TTL_MS = 6 * 60 * 60 * 1000; // 6h

type DeadEntry = { url: string; at: number };

function readDead(): DeadEntry[] {
    try {
        if (typeof sessionStorage === "undefined") return [];
        const raw = sessionStorage.getItem(DEAD_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as DeadEntry[];
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        return parsed.filter((e) => e && typeof e.url === "string" && now - e.at < DEAD_TTL_MS);
    } catch {
        return [];
    }
}

function writeDead(entries: DeadEntry[]): void {
    try {
        if (typeof sessionStorage === "undefined") return;
        sessionStorage.setItem(DEAD_KEY, JSON.stringify(entries.slice(-80)));
    } catch {
        // private mode — skip
    }
}

export function isKnownDeadApplyUrl(url: string): boolean {
    const u = url?.trim();
    if (!u) return true;
    return readDead().some((e) => e.url === u);
}

export function markDeadApplyUrl(url: string): void {
    const u = url?.trim();
    if (!u) return;
    const next = readDead().filter((e) => e.url !== u);
    next.push({ url: u, at: Date.now() });
    writeDead(next);
}

/** True when response status is a hard "posting gone" signal. */
export function isHardDeadStatus(status: number): boolean {
    return status === 404 || status === 410 || status === 422;
}

/**
 * Best-effort probe. Opaque/cors failures resolve as "unknown" (not dead) —
 * we only mark dead on an explicit 404/410/422 from a readable response.
 */
export async function probeApplyUrl(url: string, timeoutMs = 4500): Promise<"ok" | "dead" | "error" | "unknown"> {
    const u = url?.trim();
    if (!u) return "dead";
    if (isKnownDeadApplyUrl(u)) return "dead";
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        let res = await fetch(u, {
            method: "HEAD",
            redirect: "follow",
            signal: ctrl.signal,
            mode: "cors",
            credentials: "omit",
        });
        // Some ATS boards reject HEAD — retry GET without body consume.
        if (res.status === 405 || res.status === 501) {
            res = await fetch(u, {
                method: "GET",
                redirect: "follow",
                signal: ctrl.signal,
                mode: "cors",
                credentials: "omit",
            });
        }
        if (isHardDeadStatus(res.status)) {
            markDeadApplyUrl(u);
            return "dead";
        }
        if (res.ok || (res.status >= 300 && res.status < 500 && res.status !== 404)) {
            return "ok";
        }
        return "error";
    } catch {
        // CORS / network / abort — do not mark dead; employer sites often block browsers.
        return "unknown";
    } finally {
        clearTimeout(t);
    }
}

/** Pack/deck filter: drop jobs with empty or session-known-dead apply URLs. */
export function hasLiveApplyUrl(job: { apply_url?: string | null }): boolean {
    const u = job.apply_url?.trim();
    if (!u) return false;
    return !isKnownDeadApplyUrl(u);
}
