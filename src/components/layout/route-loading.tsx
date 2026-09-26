import { authRaisedPanelClassName } from "@/components/auth/auth-route-chrome";
import { cn } from "@/lib/utils";

export const posterInlinePanelClassName = authRaisedPanelClassName;

export const posterListPanelClassName = cn("overflow-hidden", authRaisedPanelClassName);

type RouteLoadingFrameProps = React.ComponentProps<"div"> & {
    label: string;
    /** When false, children are not wrapped in aria-hidden (e.g. real links in skeleton chrome). */
    hideChildrenFromAccessibilityTree?: boolean;
};

/** Shared `role="status"` wrapper for route-level loading.tsx files. */
export function RouteLoadingFrame({
    label,
    className,
    children,
    hideChildrenFromAccessibilityTree = true,
    ...rest
}: RouteLoadingFrameProps) {
    return (
        <div className={className} role="status" aria-busy="true" {...rest}>
            <span className="sr-only">{label}</span>
            {hideChildrenFromAccessibilityTree ? <div aria-hidden>{children}</div> : children}
        </div>
    );
}

export function InlinePlaceholderPanel({
    label,
    className,
    panelClassName,
    children,
}: {
    label: string;
    className?: string;
    panelClassName?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            className={cn(posterInlinePanelClassName, "p-8", panelClassName, className)}
            role="status"
            aria-busy="true"
        >
            <span className="sr-only">{label}</span>
            <div aria-hidden>{children}</div>
        </div>
    );
}
