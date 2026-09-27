import { cn } from "@/lib/utils";

type EmptyStateProps = {
    testId?: string;
    /** Section-style heading (résumé empty). Default is a single fact line. */
    titled?: boolean;
    title?: React.ReactNode;
    description?: React.ReactNode;
    /** Decorative illustration — caller must set aria-hidden on SVG/mark. */
    illustration?: React.ReactNode;
    /** inline = left stack; poster = centered column (used by ConceptAEmptyState). */
    layout?: "inline" | "poster";
    /** Primary next action — conveyor rule: one CTA per empty state. */
    actions?: React.ReactNode;
    actionsClassName?: string;
    footer?: React.ReactNode;
    className?: string;
};

export type { EmptyStateProps };

/** In-flow empty state — left-aligned fact + one next action (design-language §6). */
export function EmptyState({
    testId,
    titled = false,
    title,
    description,
    illustration,
    layout = "inline",
    actions,
    actionsClassName,
    footer,
    className,
}: EmptyStateProps) {
    const aligned = layout === "poster" ? "text-center" : "text-left";
    return (
        <div data-testid={testId} className={cn("py-8", aligned, className)}>
            {illustration ? <div className={cn(layout === "poster" ? "mb-4 flex justify-center" : "mb-4")}>{illustration}</div> : null}
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
