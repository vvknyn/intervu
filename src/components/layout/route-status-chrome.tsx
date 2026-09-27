/**
 * Poster canvas + raised panel for app-level status routes (404, segment error,
 * global error). Reuses the auth route chrome so status screens match login.
 */
export {
    authRaisedPanelClassName as routeStatusPanelClassName,
    AuthRaisedPanel as RouteStatusPanel,
    AuthRouteLayout as RouteStatusLayout,
} from "@/components/auth/auth-route-chrome";

/** Mock/gallery status layout height — pairs with `.route-status-fixture-min` in globals.css. */
export const routeStatusFixtureMinClassName = "route-status-fixture-min";
