"use client";

import { useEffect, useState } from "react";
import { ArrowsClockwise, Warning } from "@phosphor-icons/react";
import { fetchSearchDemand } from "@/actions/admin-metrics";
import type { DemandCount, DemandQuery, SearchDemand as Demand } from "@/lib/admin/search-demand";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ContextHelp } from "@/components/ui/context-help";
import { InlineSpinner, WaitBar } from "@/components/ui/wait-state";

/**
 * /admin's "Search demand": what people search for, what finds nothing or
 * too little, and which places and employers come up empty, read from the
 * anonymous search log (lib/admin/search-demand.ts). Same skin as
 * MetricsDashboard: plain sections, mono numerals, the basis of each list in
 * its ContextHelp.
 */

const NUMBER = new Intl.NumberFormat("en-US");

interface ListProps<T> {
    title: string;
    note: string;
    items: T[];
    testId: string;
    row: (item: T) => { label: string; count: number; detail?: string };
}

function DemandList<T>({ title, note, items, testId, row }: ListProps<T>) {
    return (
        <section data-testid={testId} className="min-w-0">
            <h4 className="mb-2 flex items-center text-xs font-semibold text-muted-foreground">
                {title}
                <ContextHelp content={note} />
            </h4>
            {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">None in this window.</p>
            ) : (
                <ol className="space-y-1">
                    {items.map((item) => {
                        const { label, count, detail } = row(item);
                        return (
                            <li key={label} className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="truncate" title={label}>
                                    {label}
                                </span>
                                <span className="mono-data shrink-0 text-xs text-muted-foreground">
                                    {NUMBER.format(count)}
                                    {detail && <span className="ml-2">{detail}</span>}
                                </span>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}

const queryRow = (q: DemandQuery) => ({ label: q.query, count: q.searches, detail: `${NUMBER.format(q.typicalResults)} found` });

export function SearchDemand() {
    const [demand, setDemand] = useState<Demand | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [reads, setReads] = useState(0);

    // State is set only in the read's callback, never synchronously in the
    // effect; Refresh turns the spinner on and asks for another read.
    useEffect(() => {
        let current = true;
        void fetchSearchDemand().then((result) => {
            if (!current) return;
            if ("error" in result) {
                setError(result.error);
                setDemand(null);
            } else {
                setError(null);
                setDemand(result.demand);
            }
            setIsLoading(false);
        });
        return () => {
            current = false;
        };
    }, [reads]);

    const refresh = () => {
        setIsLoading(true);
        setReads((n) => n + 1);
    };

    const thin = demand?.thinBelow ?? 30;
    const placeRow = (p: DemandCount) => ({ label: p.label, count: p.searches, detail: `${NUMBER.format(p.fewOrNone)} thin` });
    const countRow = (p: DemandCount) => ({ label: p.label, count: p.searches });

    return (
        <Card className="gap-4 p-4 sm:p-6" data-testid="search-demand">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                    Search demand
                    {demand && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                            last {demand.windowDays} days · {NUMBER.format(demand.searches)} searches
                            {demand.truncated ? " (latest only)" : ""} · {demand.noneShare}% found nothing · {demand.fewShare}% under {thin}
                        </span>
                    )}
                </h3>
                <Button variant="outline" size="sm" className="gap-2" onClick={refresh} disabled={isLoading}>
                    {isLoading ? <InlineSpinner /> : <ArrowsClockwise />}
                    Refresh
                </Button>
            </div>

            {error && (
                <p className="flex items-center gap-2 text-sm text-destructive">
                    <Warning size={16} weight="bold" />
                    {error}
                </p>
            )}

            {isLoading && !demand ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="space-y-2">
                            <WaitBar className="h-3 w-24" />
                            <WaitBar className="h-4 w-full" />
                            <WaitBar className="h-4 w-3/4" />
                        </div>
                    ))}
                </div>
            ) : (
                demand && (
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        <DemandList
                            title="Popular"
                            testId="demand-popular"
                            note="Most-searched words, with how many jobs a typical search for them found. Anonymous: no account, IP or browser id is kept, and searches built from a résumé are never logged."
                            items={demand.popular}
                            row={queryRow}
                        />
                        <DemandList
                            title="Nothing found"
                            testId="demand-nothing"
                            note="Searches whose typical result was zero jobs. Failed searches (search was down) are not counted. Roles or companies to ingest usually show up here first."
                            items={demand.nothingFound}
                            row={queryRow}
                        />
                        <DemandList
                            title={`Under ${thin} found`}
                            testId="demand-few"
                            note={`Searches whose typical result was 1 to ${thin - 1} jobs: the list shows the Broaden options.`}
                            items={demand.fewFound}
                            row={queryRow}
                        />
                        <DemandList
                            title="Companies with nothing open"
                            testId="demand-companies"
                            note={`Employers searched by name that have no open roles here, and company-scoped searches that found under ${thin}. Hand these to the crawl.`}
                            items={demand.companies}
                            row={countRow}
                        />
                        <DemandList
                            title="Places with no roles"
                            testId="demand-missing-places"
                            note={'Places typed that the index has no roles in at all (the "We have no roles in…" note).'}
                            items={demand.missingPlaces}
                            row={countRow}
                        />
                        <DemandList
                            title="Where people search"
                            testId="demand-places"
                            note={`The place a search was limited to, or the visitor's country when none was picked. "Thin" counts searches there that found under ${thin}.`}
                            items={demand.places}
                            row={placeRow}
                        />
                    </div>
                )
            )}
        </Card>
    );
}
