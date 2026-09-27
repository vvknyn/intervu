import { AuthRaisedPanel } from "@/components/auth/auth-route-chrome";
import { cn } from "@/lib/utils";
import { ConceptAEmptyIllustration } from "@/components/ui/concept-a-empty-illustration";
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";

export type ConceptAEmptyStateProps = EmptyStateProps & {
    illustration?: React.ReactNode;
    /** Poster = centered stack in a raised panel; inline = illustration above left-aligned copy. */
    layout?: "inline" | "poster";
};

/** App empty surfaces — warm copy, one CTA, shared postcard illustration grammar. */
export function ConceptAEmptyState({
    illustration,
    layout = "poster",
    className,
    actionsClassName,
    ...rest
}: ConceptAEmptyStateProps) {
    const art = illustration ?? <ConceptAEmptyIllustration className="mx-auto" />;

    if (layout === "inline") {
        return (
            <div className={cn("py-8 text-left", className)} data-testid={rest.testId}>
                <div className="mb-4">{art}</div>
                <EmptyState {...rest} className="py-0" testId={undefined} />
            </div>
        );
    }

    return (
        <AuthRaisedPanel
            data-testid={rest.testId}
            className={cn(
                "flex flex-col items-center justify-center gap-4 p-8 text-center sm:p-8",
                className,
            )}
        >
            {art}
            <EmptyState
                {...rest}
                testId={undefined}
                titled={rest.titled ?? Boolean(rest.title)}
                className="py-0 text-center [&_p]:text-muted-foreground"
                actionsClassName={cn("flex justify-center", actionsClassName)}
            />
        </AuthRaisedPanel>
    );
}
