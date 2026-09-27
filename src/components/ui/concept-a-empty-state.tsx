import { AuthRaisedPanel } from "@/components/auth/auth-route-chrome";
import { cn } from "@/lib/utils";
import { ConceptAEmptyIllustration } from "@/components/ui/concept-a-empty-illustration";
import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";

/** Shared reading width for every Concept A empty block (illustration + copy + CTA). */
export const conceptAEmptyMaxClassName = "concept-a-empty-max";

/** Base in-page empty slot — pair with a placement modifier class. */
export const conceptAEmptyPageSlotClassName = "concept-a-empty-page-slot";

/** Full-frame / deck placement — optical upper third. */
export const conceptAEmptyPageSlotPageClassName = "concept-a-empty-page-slot--page";

/** Below route controls (tracker tabs, search row). */
export const conceptAEmptyPageSlotAfterControlsClassName = "concept-a-empty-page-slot--after-controls";

export type ConceptAEmptyPagePlacement = "page" | "after-controls";

const PLACEMENT_CLASS: Record<ConceptAEmptyPagePlacement, string> = {
    page: conceptAEmptyPageSlotPageClassName,
    "after-controls": conceptAEmptyPageSlotAfterControlsClassName,
};

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
    placement,
    className,
    ...rest
}: React.ComponentProps<"div"> & {
    /** When set, applies a named top offset; omit for caller-controlled padding (e.g. search pt-6). */
    placement?: ConceptAEmptyPagePlacement;
}) {
    return (
        <div
            className={cn(
                conceptAEmptyPageSlotClassName,
                placement ? PLACEMENT_CLASS[placement] : undefined,
                className,
            )}
            {...rest}
        >
            {children}
        </div>
    );
}
