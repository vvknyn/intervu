import { CONNECT_CLIENT_IDS, type ConnectClientId } from "@/lib/connect-clients";

/** Landing instrument lanes — drives CTA label + post-auth `next`. */
export type LandingLane = "board" | "mcp" | "claw";

/** First lane a fresh visitor sees. Board first — the front door sells the
 *  job board; the AI lanes are one tab away for people who came for them
 *  (docs/specs/2026-08-07-job-seeker-front-door-design.md). */
export const DEFAULT_LANDING_LANE: LandingLane = "board";

/** Lane order + labels for the landing instrument tabs. */
export const LANDING_LANES: readonly { id: LandingLane; label: string }[] = [
    { id: "board", label: "Job board" },
    { id: "mcp", label: "Claude / ChatGPT" },
    { id: "claw", label: "OpenClaw" },
];

/** Where to send the user after sign-in for this landing lane. */
export function nextPathForLandingLane(lane: LandingLane): string {
    switch (lane) {
        case "board":
            return "/jobs";
        case "mcp":
            return "/connect?client=claude";
        case "claw":
            return "/connect?client=openclaw";
    }
}

export function signInCtaLabel(lane: LandingLane): string {
    switch (lane) {
        case "board":
            return "Browse jobs";
        case "mcp":
            return "Sign in to connect Claude";
        case "claw":
            return "Sign in to connect OpenClaw";
    }
}

export function signedInCtaLabel(lane: LandingLane): string {
    return lane === "board" ? "Browse jobs" : "Open Connect";
}

/** Map Connect `?client=` to a known id; unknown → null. */
export function parseConnectClientParam(
    raw: string | null | undefined,
): ConnectClientId | null {
    if (!raw) return null;
    const id = raw.trim().toLowerCase();
    return (CONNECT_CLIENT_IDS as readonly string[]).includes(id)
        ? (id as ConnectClientId)
        : null;
}
