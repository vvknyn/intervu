"use client";

/**
 * The signed-out job alert form where /jobs opens it, in its two framings: under the results line's "Job alert"
 * switch (compact, inside the list's inset) and on a search with no results (with its heading).
 *
 * The real surface sits behind a search the cloud cannot run (the index is unreachable) and draws its security check
 * only in a build that has a Turnstile site key, so a layout audit of /jobs alone never sees the form with its widget.
 * This renders the same component, so the pixels measured are the shipped ones. The security check is the real
 * wrapper: where a build has a key and the browser can load Cloudflare's script it is the 300x65 widget.
 */
import { SearchAlertCapture } from "@/components/jobs/SearchAlertCapture";
import { PageTitle } from "@/components/ui/heading";

function Case({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
    return (
        <section data-testid={id} className="border border-border bg-card p-5">
            <h2 className="text-xs font-semibold text-muted-foreground">{title}</h2>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">{note}</p>
            <div className="border-t border-dashed border-border pt-4">{children}</div>
        </section>
    );
}

const noop = () => {};

export function SearchAlertMock() {
    return (
        <div className="shell-row flex flex-col gap-6 py-8" data-testid="search-alert-mock">
            <header>
                <PageTitle>Job alert form — both places it opens</PageTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                    Fixture for pixel verification. Not linked from anywhere and not indexed.
                </p>
            </header>

            <Case
                id="search-alert-case-results"
                title="with results · opened from the Job alert switch"
                note="Compact: no heading, the switch above already names it. Sits in the list's inset."
            >
                <div className="poster-list-inset-x">
                    <SearchAlertCapture
                        surface="results"
                        searchName="product owner"
                        searchHref="/jobs?q=product+owner"
                        filterCount={0}
                        queryLength={13}
                        hasResults
                        compact
                        onDismiss={noop}
                    />
                </div>
            </Case>

            <Case id="search-alert-case-empty" title="no results · offered under the empty state" note="Same form with its heading.">
                <SearchAlertCapture
                    surface="zero_results"
                    searchName="product owner"
                    searchHref="/jobs?q=product+owner"
                    filterCount={0}
                    queryLength={13}
                    hasResults={false}
                    onDismiss={noop}
                />
            </Case>
        </div>
    );
}
