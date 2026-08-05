/** Routes where TopBar, Footer, and MobileTabBar stay hidden for full-bleed surfaces. */
export function shouldHideSiteChrome(pathname: string): boolean {
    return pathname === "/" || pathname.startsWith("/login") || pathname.startsWith("/auth");
}
