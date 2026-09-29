"use client";

import React from "react";
import { MagnifyingGlass, MapPin, Moon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { SEARCH_PLACEHOLDER } from "@/lib/jobs/search-copy";
import { PageTitle } from "@/components/ui/heading";

/**
 * Mockup for docking the /jobs search line into the header on scroll.
 *
 * Two rules the treatments below all obey, because breaking either is what
 * makes this pattern annoying rather than helpful:
 *
 *  1. The header does NOT get taller when the search arrives. It is a fixed
 *     56px in both states. A header that grows on scroll steals a result row
 *     back every single time someone scrolls.
 *  2. The docked search stays operable. Whatever shrinks has to still be a
 *     way back to the full control, or the location field becomes unreachable
 *     the moment you scroll.
 */

const NAV = ["Jobs", "Resume", "Tracker", "Connect"];

function Field({ compact = false, queryOnly = false }: { compact?: boolean; queryOnly?: boolean }) {
    const h = compact ? "h-8" : "h-11";
    return (
        <div className="flex min-w-0 flex-1 rounded-none border border-border bg-card divide-x divide-border">
            {/* `min-w-0` + `truncate` on the text, not the flex row: a fixed-height
                slot with wrappable text is how the facet rail overlapped, and a
                placeholder is exactly the kind of string that outgrows its box. */}
            <div className="flex min-w-0 flex-1 items-center">
                <MagnifyingGlass weight="bold" className="ml-2.5 shrink-0 text-muted-foreground" />
                <div className={cn(h, "flex min-w-0 flex-1 items-center px-2.5")}>
                    <span className="truncate text-xs text-muted-foreground">
                        {compact ? "Software Engineer" : SEARCH_PLACEHOLDER}
                    </span>
                </div>
            </div>
            {/* Treatment 03 docks the query ALONE — location and the button stay
                in the page toolbar. Without this the docked headers for 01 and 03
                were byte-identical, which made the comparison meaningless. */}
            {!queryOnly && (
                <>
                    <div className={cn("flex shrink-0 items-center", compact ? "w-[132px]" : "w-[260px]")}>
                        <MapPin weight="bold" className="ml-2.5 shrink-0 text-muted-foreground" />
                        <div className={cn(h, "flex min-w-0 flex-1 items-center px-2.5")}>
                            <span className="truncate text-xs text-muted-foreground">
                                {compact ? "Toronto" : "City, state, or remote"}
                            </span>
                        </div>
                    </div>
                    <button
                        type="button"
                        className={cn(h, "shrink-0 rounded-none bg-foreground px-4 text-xs font-semibold text-background")}
                    >
                        Search
                    </button>
                </>
            )}
        </div>
    );
}

/** The docked control for the "summary pill" treatment — one tap re-opens. */
function Pill() {
    return (
        <button
            type="button"
            // control-type-allow: mock of the search dock at rest — it reads as the field it opens, not a button face
            className="ctl-md flex min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded-none border border-foreground bg-card px-3 text-left"
        >
            <MagnifyingGlass weight="bold" className="shrink-0 text-foreground" />
            <span className="truncate text-xs font-semibold text-foreground">Software Engineer</span>
            <span className="text-muted-foreground">·</span>
            <span className="truncate text-xs text-muted-foreground">Toronto</span>
            <span className="ml-auto shrink-0 mono-data text-xs text-muted-foreground">
                Edit
            </span>
        </button>
    );
}

type Treatment = "full" | "pill" | "query";

function Header({ docked, treatment }: { docked: boolean; treatment: Treatment }) {
    return (
        <header className="sticky top-0 z-20 h-14 border-b border-border bg-background">
            <div className="flex h-14 items-center gap-3 px-4">
                {/* Wordmark collapses to the mark alone to free the centre. */}
                <div className="flex shrink-0 items-center gap-1.5 font-semibold text-foreground">
                    <span className="mono-data text-sm">[•]</span>
                    <span
                        className={cn(
                            "overflow-hidden whitespace-nowrap text-sm transition-all duration-300 motion-reduce:transition-none",
                            docked ? "max-w-0 opacity-0" : "max-w-[120px] opacity-100",
                        )}
                    >
                        VELAI
                    </span>
                </div>

                {/* Centre slot: live-roles chip at rest, the search once docked. */}
                <div className="flex min-w-0 flex-1 items-center justify-center px-2">
                    {docked ? (
                        <div className="flex w-full min-w-0 items-center justify-center">
                            {treatment === "pill" ? <Pill /> : <Field compact queryOnly={treatment === "query"} />}
                        </div>
                    ) : (
                        <span className="whitespace-nowrap border border-brand bg-muted px-2.5 py-1 mono-data text-xs font-semibold text-brand">
                            2,071,759 live roles
                        </span>
                    )}
                </div>

                {/* Nav compresses toward the corner rather than disappearing —
                    losing navigation on scroll is a bigger cost than losing a
                    few pixels of label. */}
                <nav className="flex shrink-0 items-center gap-3">
                    {NAV.map((n) => (
                        <span
                            key={n}
                            className={cn(
                                "overflow-hidden whitespace-nowrap text-xs font-semibold transition-all duration-300 motion-reduce:transition-none",
                                n === "Jobs" ? "text-foreground" : "text-muted-foreground",
                                docked && n !== "Jobs" ? "max-w-0 opacity-0" : "max-w-[90px] opacity-100",
                            )}
                        >
                            {n}
                        </span>
                    ))}
                    {docked && (
                        <span className="text-xs font-semibold text-muted-foreground" aria-label="More">
                            ···
                        </span>
                    )}
                    <Moon className="shrink-0 text-muted-foreground" />
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-none bg-foreground text-xs font-semibold text-background">
                        VN
                    </span>
                </nav>
            </div>
        </header>
    );
}

function Rows() {
    const rows = [
        ["Senior Software Engineer", "Shopify", "CAD 140k–190k/yr"],
        ["Backend Engineer, Payments", "Wealthsimple", "CAD 120k–160k/yr"],
        ["Staff Engineer, Platform", "Faire", "CAD 180k–220k/yr"],
        ["Software Engineer II", "RBC", "CAD 95k–130k/yr"],
        ["Full Stack Developer", "Clio", "CAD 110k–145k/yr"],
        ["Site Reliability Engineer", "Hootsuite", "CAD 125k–165k/yr"],
    ];
    return (
        <div className="space-y-2 p-4">
            {rows.map(([t, c, p]) => (
                <div key={t} className="border border-border bg-card px-3 py-2.5">
                    <div className="text-xs font-semibold text-foreground">{t}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{c}</div>
                    <div className="mt-1 mono-data text-xs text-foreground">{p}</div>
                </div>
            ))}
        </div>
    );
}

/**
 * One scrollable frame per treatment. The frame owns its own scroll so all
 * three can be compared on one page — scroll inside any of them to dock it.
 */
function DockFrame({ treatment, forceDocked }: { treatment: Treatment; forceDocked?: boolean }) {
    const [scrolled, setScrolled] = React.useState(false);
    const docked = forceDocked ?? scrolled;

    return (
        <div
            data-testid={`dock-frame-${treatment}`}
            data-docked={docked ? "true" : "false"}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 40)}
            className="h-[380px] overflow-y-auto border border-border bg-background custom-scrollbar"
        >
            <Header docked={docked} treatment={treatment} />

            {/* The page's own search block collapses as the header takes it over.
                `grid-rows-[0fr]` rather than unmounting: the same trick the real
                landing masthead uses, so nothing inside ever loses focus. */}
            <div
                className={cn(
                    "grid transition-all duration-300 motion-reduce:transition-none",
                    docked ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
                )}
            >
                <div className="overflow-hidden">
                    <div className="border-b border-border bg-muted p-3">
                        <Field />
                    </div>
                </div>
            </div>

            {/* Treatment 03 keeps location and filters in a toolbar that never
                moves — the point of that option is that only the query travels. */}
            {treatment === "query" && (
                <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2">
                    {["Toronto", "Past month", "Remote", "All filters"].map((chip) => (
                        <span key={chip} className="border border-border px-2 py-1 text-xs text-muted-foreground">
                            {chip}
                        </span>
                    ))}
                </div>
            )}

            <Rows />
        </div>
    );
}

const TREATMENTS: { id: Treatment; name: string; how: string; cost: string }[] = [
    {
        id: "full",
        name: "The whole search moves up",
        how: "Query, location and the Search button all slide into the header. The wordmark drops to just the mark and the nav labels fold into a menu.",
        cost: "Everything stays usable without a click. It is also the most crowded — on a narrow laptop the nav has to give up almost all its labels.",
    },
    {
        id: "pill",
        name: "It shrinks to what you searched",
        how: "The header shows your actual query and city as one small button. Clicking it opens the full search again.",
        cost: "Calmest of the three and it tells you what you are looking at. Costs one click to change anything — the Airbnb approach.",
    },
    {
        id: "query",
        name: "Only the job box moves",
        how: "The query field docks; location and filters stay in the toolbar below where they already are.",
        cost: "Least disruptive and the header stays roomy. But the search is now split across two places, which is the thing to watch.",
    },
];

export function SearchDockMock() {
    return (
        <div className="shell-row py-10">
            <PageTitle>
                Docking the search into the header on scroll
            </PageTitle>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Scroll inside any frame below to see it happen. The header stays exactly 56px tall
                in both states — it never grows to make room, because that would cost a result row
                on every scroll.
            </p>

            <div className="mt-10 space-y-12">
                {TREATMENTS.map((t, i) => (
                    <div key={t.id}>
                        <div className="flex items-baseline gap-3 border-b border-foreground pb-2">
                            <span className="mono-data text-xs text-muted-foreground">
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="text-sm font-semibold text-foreground">{t.name}</span>
                        </div>
                        <p className="mt-3 max-w-3xl text-xs text-muted-foreground">{t.how}</p>
                        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{t.cost}</p>

                        {/* Stacked, NOT side by side. Two half-width frames made the
                            docked query field truncate to "Soft…" purely because each
                            frame was ~530px — a real header is the full page width, so
                            the columns were making treatment 01 look worse than it is. */}
                        <div className="mt-5 space-y-4">
                            <div>
                                <div className="mb-1.5 mono-data text-xs text-muted-foreground">
                                    At rest — scroll me
                                </div>
                                <DockFrame treatment={t.id} />
                            </div>
                            <div>
                                <div className="mb-1.5 mono-data text-xs text-muted-foreground">
                                    Docked
                                </div>
                                <DockFrame treatment={t.id} forceDocked />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
