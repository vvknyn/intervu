import { cn } from "@/lib/utils";

type EmptyStateProps = {
    testId?: string;
    /** Section-style heading (résumé empty). Default is a single fact line. */
    titled?: boolean;
    title?: React.ReactNode;
    description?: React.ReactNode;
    /** Primary next action — conveyor rule: one CTA per empty state. */
    actions?: React.ReactNode;
    actionsClassName?: string;
    footer?: React.ReactNode;
    className?: string;
};

/** In-flow empty state — left-aligned fact + one next action (design-language §6). */
export function EmptyState({
    testId,
    titled = false,
    title,
    description,
    actions,
    actionsClassName,
    footer,
    className,
}: EmptyStateProps) {
    return (
        <div data-testid={testId} className={cn("py-8 text-left", className)}>
            {title ? (
                titled ? (
                    <h2 className="text-base font-semibold text-foreground">{title}</h2>
                ) : (
                    <p className="text-sm text-foreground">{title}</p>
                )
            ) : null}
            {description ? (
                <p className={cn("text-sm text-muted-foreground", title ? "mt-1" : undefined)}>{description}</p>
            ) : null}
            {actions ? <div className={cn("mt-3", actionsClassName)}>{actions}</div> : null}
            {footer ? <div className="mt-3">{footer}</div> : null}
        </div>
    );
}
