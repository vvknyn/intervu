import { WaitState } from "@/components/ui/wait-state";
import { PageLayout } from "@/components/layout/PageLayout";

/**
 * Settings' one loading state — used both as the Suspense fallback
 * (app/settings/page.tsx, while useSearchParams resolves) and as
 * SettingsContainer's own gate while the async auth check is in flight.
 * Both used to render their own near-duplicate spinner block; this is the
 * single markup either site imports, so there is nothing left to drift
 * between them.
 */
export function SettingsLoading() {
    return (
        <PageLayout fullWidth>
            <div className="shell-row py-16">
                <WaitState
                    label="Loading account"
                    className="flex min-h-40 flex-col items-center justify-center rounded-panel border border-border bg-surface p-10 shadow-[var(--shadow-bevel-highlight)]"
                />
            </div>
        </PageLayout>
    );
}
