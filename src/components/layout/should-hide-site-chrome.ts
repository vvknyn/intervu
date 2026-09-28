/** Routes where TopBar, Footer, and MobileTabBar stay hidden for full-bleed surfaces. */
export function shouldHideSiteChrome(pathname: string): boolean {
    return (
        pathname.startsWith("/login") ||
        pathname.startsWith("/auth") ||
        pathname.startsWith("/mock") ||
        pathname.startsWith("/oauth")
    );
}

/**
 * Lean Betalist product loop — hub / For-you deck / apply-return all live under
 * `/jobs` and `/resume`. On these surfaces we drop surplus chrome (desktop header MCP link,
 * dense multi-link footer) while keeping TopBar shell, MobileTabBar, and the
 * in-deck MCP handoff (`for-you-mcp-handoff`).
 */
export function isLeanProductSurface(pathname: string): boolean {
    return (
        pathname === "/jobs" ||
        pathname.startsWith("/jobs/") ||
        pathname === "/resume" ||
        pathname.startsWith("/resume/")
    );
}

/**
 * `/careers/remote-jobs` is an indexable hub, not a product walk. Its global
 * footer was the marketing link farm (alternatives, career hubs, research).
 * Quiet that one path to the Privacy/Terms strip. Other hubs keep the farm.
 */
export function isQuietFooterPath(pathname: string): boolean {
    return pathname === "/careers/remote-jobs";
}
