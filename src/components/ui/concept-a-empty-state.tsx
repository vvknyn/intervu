import { AuthRaisedPanel } from "@/components/auth/auth-route-chrome";
import { cn } from "@/lib/utils";
import { ConceptAEmptyIllustration } from "@/components/ui/concept-a-empty-illustration";
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";

/** Shared reading width for every Concept A empty block (illustration + copy + CTA). */
export const conceptAEmptyMaxClassName = "concept-a-empty-max";

/** In-page empty placement — optical upper third, safe-area aware (tracker, history, search). */
export const conceptAEmptyPageSlotClassName = "concept-a-empty-page-slot";

export type ConceptAEmptyStateProps = EmptyStateProps & {
    illustration?: React.ReactNode;
    /** @deprecated All Concept A empties render centered; value is ignored. */
    layout?: "inline" | "poster";
    /** SERP-style empties — tighter vertical rhythm, same centered stack. */
    density?: "default" | "compact";
};

/** App empty surfaces — warm copy, one centered CTA, shared postcard illustration grammar. */
export function ConceptAEmptyState({
    illustration,
    density = "default",
    className,
    actionsClassName,
    ...rest
}: ConceptAEmptyStateProps) {
    const art = illustration ?? <ConceptAEmptyIllustration className="mx-auto" />;
    const compact = density === "compact";

    return (
        <AuthRaisedPanel
            data-testid={rest.testId}
            className={cn(
                conceptAEmptyMaxClassName,
                "flex flex-col items-center text-center",
                compact ? "gap-2 p-4 sm:p-6" : "gap-4 p-6 sm:p-8",
                className,
            )}
        >
            {art}
            <EmptyState
                {...rest}
                testId={undefined}
                layout="poster"
                titled={rest.titled ?? Boolean(rest.title)}
                className="py-0 text-center [&_p]:text-muted-foreground"
                actionsClassName={cn("flex justify-center", actionsClassName)}
            />
        </AuthRaisedPanel>
    );
}

export function ConceptAEmptyPageSlot({
    children,
    className,
    ...rest
}: React.ComponentProps<"div">) {
    return (
        <div className={cn(conceptAEmptyPageSlotClassName, className)} {...rest}>
            {children}
        </div>
    );
}
