import { cn } from "@/lib/utils";

/** Single inline error surface for settings sections — pairs with P1-8 (no duplicate toasts). */
export function SettingsInlineError({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div role="alert" aria-live="assertive" className={cn("text-sm text-danger-text", className)}>
            {children}
        </div>
    );
}
