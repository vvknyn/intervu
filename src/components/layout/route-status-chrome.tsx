/**
 * In-flow status chrome for app-level routes (404, segment error). Renders
 * inside the root layout `<main>` so TopBar and footer stay available.
 * Global error keeps its own full-document shell.
 */
import { AuthRaisedPanel, authRaisedPanelClassName } from "@/components/auth/auth-route-chrome";
import { cn } from "@/lib/utils";

export const routeStatusPanelClassName = authRaisedPanelClassName;
export const RouteStatusPanel = AuthRaisedPanel;

export const routeStatusInFlowClassName = "route-status-in-flow";
export const routeStatusUpperSlotClassName = "route-status-upper-slot";

/** Mock/gallery status layout height — pairs with `.route-status-fixture-min` in globals.css. */
export const routeStatusFixtureMinClassName = "route-status-fixture-min";

export function RouteStatusLayout({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn(routeStatusInFlowClassName, className)}>
            <div className={routeStatusUpperSlotClassName}>{children}</div>
        </div>
    );
}
