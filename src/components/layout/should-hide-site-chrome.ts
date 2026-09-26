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
 * `/jobs`. On these surfaces we drop surplus chrome (desktop header MCP link,
 * dense multi-link footer) while keeping TopBar shell, MobileTabBar, and the
 * in-deck MCP handoff (`for-you-mcp-handoff`).
 */
export function isLeanProductSurface(pathname: string): boolean {
    return pathname === "/jobs" || pathname.startsWith("/jobs/");
}
