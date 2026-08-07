import { CONNECT_CLIENT_IDS, type ConnectClientId } from "@/lib/connect-clients";

/** Landing instrument lanes — drives CTA label + post-auth `next`. */
export type LandingLane = "board" | "mcp" | "claw";

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
