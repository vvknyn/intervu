"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, Warning } from "@phosphor-icons/react";
import { fetchAdminMetrics } from "@/actions/admin-metrics";
import { groupMetrics, WINDOWS, type Metric, type MetricsReport } from "@/lib/admin/metrics-shape";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ContextHelp } from "@/components/ui/context-help";
import { WaitBar } from "@/components/ui/wait-state";

/**
 * /admin's metrics dashboard — the standard "stat tiles grouped into sections"
 * pattern, wearing the house skin (0px geometry, no elevation, `.mono-data`
 * numerals). No new interaction is invented here: sections are plain cards,
 * every number's caveat lives in the existing `ContextHelp` tooltip, and the
 * only control is a refresh button.
 *
 * It imports `metrics-shape`, never `metrics` — the latter pulls firebase-admin
 * in and this is a client component.
 */

const NUMBER = new Intl.NumberFormat("en-US");

/** Pure: what goes in the big slot. A metric that failed shows an em dash —
 *  never 0, which would read as a real, measured zero. */
function headline(metric: Metric): string {
    if (metric.value === null) return "—";
    return metric.unit === "percent" ? `${NUMBER.format(metric.value)}%` : NUMBER.format(metric.value);
}

function StatTile({ metric }: { metric: Metric }) {
    return (
        <div className="min-w-0">
            <dt className="flex items-center text-xs text-muted-foreground">
                <span className="truncate">{metric.label}</span>
                <ContextHelp content={metric.note} />
            </dt>
            <dd className="mono-data mt-1 text-2xl leading-none">{headline(metric)}</dd>
            {metric.windows && (
                <p className="mono-data mt-1.5 text-xs text-muted-foreground">
                    {WINDOWS.map(({ label }) => `${label} ${NUMBER.format(metric.windows?.[label] ?? 0)}`).join("  ·  ")}
                </p>
            )}
            {metric.caveat && <p className="mt-1 text-xs text-muted-foreground">{metric.caveat}</p>}
            {metric.error && (
                <p className="mt-1 text-xs text-destructive" title={metric.error}>
                    {metric.error}
                </p>
            )}
        </div>
    );
}

export function MetricsDashboard() {
    const [report, setReport] = useState<MetricsReport | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // No synchronous setState in here: the spinner starts on via `isLoading`'s
    // initial value, and the refresh BUTTON turns it back on. An effect that
    // set it would cascade a second render before the fetch even starts.
    const load = useCallback(async () => {
        const result = await fetchAdminMetrics();
        if ("error" in result) {
            setError(result.error);
            setReport(null);
        } else {
            setError(null);
            setReport(result.report);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const refresh = () => {
        setIsLoading(true);
        void load();
    };

    const collectedAt = report
        ? new Date(report.collectedAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
          })
        : null;

    return (
        <Card className="gap-4 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                    Metrics
                    {collectedAt && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">as of {collectedAt}</span>
                    )}
                </h3>
                <Button variant="outline" size="sm" className="gap-2" onClick={refresh} disabled={isLoading}>
                    <ArrowsClockwise className={isLoading ? "animate-spin" : undefined} />
                    Refresh
                </Button>
            </div>

            {error && (
                <p className="flex items-center gap-2 text-sm text-destructive">
                    <Warning size={16} weight="bold" />
                    {error}
                </p>
            )}

            {isLoading && !report ? (
                <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
                    {Array.from({ length: 8 }, (_, i) => (
                        <div key={i} className="space-y-2">
                            <WaitBar className="h-3 w-24" />
                            <WaitBar className="h-7 w-16" />
                        </div>
                    ))}
                </div>
            ) : (
                report &&
                groupMetrics(report.metrics).map(({ group, metrics }) => (
                    <section key={group} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                        <h4 className="mb-3 text-xs font-semibold text-muted-foreground">
                            {group}
                        </h4>
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
                            {metrics.map((metric) => (
                                <StatTile key={metric.id} metric={metric} />
                            ))}
                        </dl>
                    </section>
                ))
            )}
        </Card>
    );
}
