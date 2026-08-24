"use client";

import React from "react";
import { MagnifyingGlass, MapPin } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * The /jobs search line, reduced to static markup. Every class on the field
 * and the button is copied verbatim from `app/jobs/page.tsx` so a treatment
 * that reads well here reads the same way once shipped — the only thing the
 * variants below change is the SHELL wrapped around this.
 */
function SearchLine({ invert = false, tall = false }: { invert?: boolean; tall?: boolean }) {
    const h = tall ? "h-[58px]" : "h-11 sm:h-[46px]";
    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-2.5">
            <div className="flex flex-col rounded-none border border-border bg-card divide-y divide-border sm:flex-1 sm:flex-row sm:divide-y-0 sm:divide-x">
                <div className="relative flex min-w-0 w-full sm:flex-1 items-center">
                    <MagnifyingGlass size={16} weight="bold" className="ml-3 shrink-0 text-muted-foreground" />
                    <div className={cn(h, "flex flex-1 items-center px-3 text-sm text-muted-foreground/70")}>
                        Job title, skill, or company
                    </div>
                </div>
                <div className="relative flex min-w-0 w-full items-center sm:w-[300px]">
                    <MapPin size={16} weight="bold" className="ml-3 shrink-0 text-muted-foreground" />
                    <div className={cn(h, "flex flex-1 items-center px-3 text-sm text-muted-foreground/70")}>
                        City, state, or remote
                    </div>
                </div>
            </div>
            <button
                type="button"
                className={cn(
                    h,
                    "rounded-none px-6 text-xs font-bold uppercase tracking-wider transition-colors",
                    invert ? "bg-background text-foreground hover:bg-background/90" : "bg-foreground text-background hover:bg-foreground/90",
                )}
            >
                Search
            </button>
        </div>
    );
}

/**
 * Each variant owns its own frame rather than being switched on by id — the
 * treatments differ STRUCTURALLY (some add a bar, some invert the ground, one
 * bleeds past the container), so a render function is the honest seam. A pile
 * of booleans on one shell would only push the branching somewhere less
 * readable.
 */
const VARIANTS: {
    id: string;
    name: string;
    how: string;
    tradeoff: string;
    render: () => React.ReactNode;
}[] = [
    {
        id: "current",
        name: "What is live today",
        how: "A grey fill, a soft border, and a large drop shadow underneath.",
        tradeoff: "Shown only as the thing to compare against. Everything below drops the shadow.",
        render: () => (
            <section className="rounded-none glass-panel glass-panel-raised p-2 sm:p-2.5">
                <SearchLine />
            </section>
        ),
    },
    {
        id: "keyline",
        name: "Heavy outline",
        how: "A thick black frame around the box, white inside, nothing underneath it.",
        tradeoff: "Already how every section heading on the page is drawn, so it needs no new idea. Quiet — it holds the eye rather than grabbing it.",
        render: () => (
            <section className="rounded-none border-2 border-foreground bg-card p-2 sm:p-2.5">
                <SearchLine />
            </section>
        ),
    },
    {
        id: "inverted",
        name: "Dark surround",
        how: "The box sits on solid near-black, so the white search field is the brightest thing on the screen.",
        tradeoff: "The strongest signal available without colour. Heavy — it will dominate the page, which is either the point or too much.",
        render: () => (
            <section className="rounded-none bg-foreground p-3">
                <SearchLine invert />
            </section>
        ),
    },
    {
        id: "brand-edge",
        name: "Coloured top edge",
        how: "A thin blue bar across the top of an otherwise plain box.",
        tradeoff: "Reuses the accent already on the selected job row, so it reads as 'this is the active thing'. Cheapest change of the six.",
        render: () => (
            <section className="rounded-none border border-border border-t-[3px] border-t-brand bg-muted/40 p-2 sm:p-2.5">
                <SearchLine />
            </section>
        ),
    },
    {
        id: "band",
        name: "Recessed band",
        how: "Nothing is raised. A tinted strip runs the full width of the page behind the search, and the white field sits on it.",
        tradeoff: "Reads as a distinct zone rather than a floating card. Needs the strip to reach both page edges to work, so it changes the page frame, not just the box.",
        render: () => (
            <div className="-mx-8 bg-muted/70 px-8 py-6">
                <SearchLine />
            </div>
        ),
    },
    {
        id: "scale",
        name: "Bigger, with a count",
        how: "No frame at all. A taller field, and a small line of type above it saying how many roles are searchable.",
        tradeoff: "Importance from size and information instead of decoration. Fits the plain-type look, but it leans on the field's own border to hold the shape.",
        render: () => (
            <section className="rounded-none">
                <div className="mb-2 mono-data text-[11px] uppercase tracking-wider text-muted-foreground">
                    Search 2,069,897 live roles
                </div>
                <SearchLine tall />
            </section>
        ),
    },
    {
        id: "brackets",
        name: "Corner marks",
        how: "Four short rules at the corners instead of a full border, like crop marks on a print proof.",
        tradeoff: "Distinctive and very light-touch. More of a stylistic statement than an emphasis tool — it may read as decoration rather than importance.",
        render: () => (
            <section className="relative rounded-none bg-muted/30 p-3">
                {[
                    "left-0 top-0 border-l-2 border-t-2",
                    "right-0 top-0 border-r-2 border-t-2",
                    "left-0 bottom-0 border-l-2 border-b-2",
                    "right-0 bottom-0 border-r-2 border-b-2",
                ].map((pos) => (
                    <span key={pos} aria-hidden className={cn("pointer-events-none absolute h-4 w-4 border-foreground", pos)} />
                ))}
                <SearchLine />
            </section>
        ),
    },
];

export function SearchEmphasisMock() {
    return (
        <div className="mx-auto max-w-5xl px-8 py-10">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Making the search box matter — without a shadow
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Six alternatives to the drop shadow, each drawn with the real search field so
                nothing changes when one gets picked. The first panel is what is live now.
            </p>

            <div className="mt-10 space-y-12">
                {VARIANTS.map((v, i) => (
                    <div key={v.id} data-testid={`variant-${v.id}`}>
                        <div className="flex items-baseline gap-3 border-b border-foreground pb-2">
                            <span className="mono-data text-[11px] text-muted-foreground">
                                {String(i).padStart(2, "0")}
                            </span>
                            <span className="text-sm font-semibold text-foreground">{v.name}</span>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">{v.how}</p>
                        <p className="mt-1 text-xs text-muted-foreground/80">{v.tradeoff}</p>
                        <div className="mt-5 overflow-hidden">{v.render()}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}
