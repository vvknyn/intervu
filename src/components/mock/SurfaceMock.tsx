"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { chipVariants } from "@/components/ui/chip";

/**
 * Two decisions on one page, both about the SERP's surface rather than its
 * controls:
 *
 *  1. PAGE WIDTH — /jobs is capped at `max-w-6xl xl:max-w-7xl` (1280px), so a
 *     wide display spends a third of its width on empty gutter.
 *  2. PAGE GROUND — `--background` is `250 250 250`: a pure neutral with no
 *     hue at all, five points off the pure-white cards sitting on it. That
 *     flatness is what reads as "dull white".
 *
 * Both sections render at TRUE scale — full-bleed bands, stacked, never
 * side-by-side thumbnails. A width comparison shrunk into a column lies about
 * the thing being compared, and a colour judged as a 60px swatch lies about
 * how it reads across a whole screen.
 */

/* ------------------------------ page width ------------------------------ */

type WidthOption = {
    id: string;
    name: string;
    cls: string;
    /** null = no cap; the band fills the viewport minus its padding. */
    cap: number | null;
    note: string;
};

const WIDTH_OPTIONS: WidthOption[] = [
    {
        id: "current",
        name: "Current",
        cls: "max-w-6xl xl:max-w-7xl px-4 sm:px-8 xl:px-10",
        cap: 1280,
        note: "What ships today. Comfortable on a laptop; on a wide display the results list stays narrow while the gutters grow.",
    },
    {
        id: "wide",
        name: "Wider cap",
        cls: "max-w-[1600px] px-4 sm:px-8 xl:px-10",
        cap: 1600,
        note: "Same shape, more room. Reclaims most of the gutter on a 1920 display and still stops before the detail pane's text lines get too long to read.",
    },
    {
        id: "bleed",
        name: "Full bleed",
        cls: "w-full px-6",
        cap: null,
        note: "No cap at all — the layout always touches both edges. Maximum density, but on a very wide monitor the description pane runs to line lengths that are genuinely harder to read.",
    },
    {
        id: "hybrid",
        name: "Full-bleed chrome, capped results",
        cls: "w-full px-6 · inner max-w-[1600px]",
        cap: null,
        note: "Header, search box and toolbar run edge to edge; the three-column results grid keeps a cap. The white gutters disappear from everything the eye reads as chrome, and body text keeps a sane measure.",
    },
];

/**
 * The search shell and filter toolbar. Present because the fourth option is
 * defined ENTIRELY by treating chrome differently from the results grid — with
 * no chrome drawn, it rendered byte-identically to "Full bleed" and the choice
 * between them was unreadable.
 */
function Chrome() {
    return (
        <div className="mb-3">
            <div className="flex items-stretch border border-border bg-card">
                <div className="flex-1 px-3 py-2 text-xs text-foreground">Product Manager</div>
                <div className="w-[190px] border-l border-border px-3 py-2 text-xs text-muted-foreground">
                    City, state, or remote
                </div>
                <div className="bg-foreground px-5 py-2 mono-data text-xs font-semibold text-background">
                    Search
                </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-y border-border py-1.5">
                {["Posted · Past month", "Salary", "Work mode", "Experience", "All filters"].map((l, i) => (
                    <span key={l} className={cn(chipVariants({ active: i === 0 }), "mono-data")}>{l}</span>
                ))}
                <span className={cn(chipVariants({ active: false }), "mono-data ml-auto")}>Add résumé</span>
                <span className={cn(chipVariants({ active: false }), "mono-data")}>Freshest · Top pay · Best match</span>
            </div>
        </div>
    );
}

function MiniSerp() {
    return (
        <div className="flex gap-3">
            <div className="hidden w-[190px] shrink-0 flex-col gap-1.5 border border-border bg-card p-2.5 lg:flex">
                <div className="mono-data text-xs font-semibold text-muted-foreground">Date posted</div>
                {["Any date", "Past week", "Past month"].map((l) => (
                    <div key={l} className="text-xs text-muted-foreground">{l}</div>
                ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {[
                    ["Group Product Manager — Home Financing", "Bank of Montreal"],
                    ["Senior Product Manager, B2B", "Okta"],
                    ["Senior Product Manager, Carrot Ads", "Instacart"],
                ].map(([t, c], i) => (
                    <div key={t} className={cn("border border-border p-2.5", i === 0 ? "bg-brand/[0.06] border-brand" : "bg-card")}>
                        <div className="truncate text-xs font-semibold text-foreground">{t}</div>
                        <div className="mono-data text-xs text-muted-foreground">{c}</div>
                    </div>
                ))}
            </div>
            <div className="hidden min-w-0 flex-1 flex-col gap-1.5 border border-border bg-card p-2.5 xl:flex">
                <div className="text-xs font-semibold text-foreground">Group Product Manager — Home Financing</div>
                <div className="mono-data text-xs text-muted-foreground">Bank of Montreal · Toronto, ON</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                    BMO Financial Group&apos;s expected target for the first year in this position. Total
                    compensation will vary based on the pay type of the position and may include
                    performance-based incentives and discretionary bonuses, as well as other perks.
                </p>
            </div>
        </div>
    );
}

function WidthBand({ option, viewport }: { option: WidthOption; viewport: number }) {
    const padding = option.id === "bleed" || option.id === "hybrid" ? 48 : 80;
    const used = option.cap === null ? viewport : Math.min(option.cap, viewport);
    const gutter = Math.max(0, Math.round((viewport - used) / 2));
    return (
        <section className="border-t border-border py-6">
            <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6">
                <h3 className="text-sm font-semibold text-foreground">{option.name}</h3>
                <code className="mono-data text-xs text-muted-foreground">{option.cls}</code>
                <span className={cn(chipVariants({ active: gutter === 0 }), "mono-data ml-auto")}>
                    {gutter === 0 ? "no gutter" : `${gutter}px gutter each side`}
                </span>
            </header>
            <p className="mb-3 max-w-[70ch] px-6 text-xs leading-relaxed text-muted-foreground">{option.note}</p>
            {/* The band is deliberately full-bleed: the tinted area IS the wasted
                space being decided about, so it has to be shown at real size. */}
            <div className="w-full bg-brand/[0.05]" data-band={option.id}>
                {option.id === "hybrid" ? (
                    // The whole point of this option: chrome touches both edges,
                    // the results grid does not.
                    <>
                        <div className="w-full bg-background px-6 pt-3">
                            <Chrome />
                        </div>
                        <div className="mx-auto bg-background px-6 pb-3" style={{ maxWidth: 1600 }}>
                            <MiniSerp />
                        </div>
                    </>
                ) : (
                    <div
                        className="mx-auto bg-background py-3"
                        style={{ maxWidth: option.cap ?? "none", paddingLeft: padding / 2, paddingRight: padding / 2 }}
                    >
                        <Chrome />
                        <MiniSerp />
                    </div>
                )}
            </div>
        </section>
    );
}

/* ------------------------------ page ground ------------------------------ */

type GroundOption = {
    id: string;
    name: string;
    /** `--background` / `--card`, as the `R G B` triples globals.css uses. */
    bg: string;
    card: string;
    note: string;
};

const GROUND_OPTIONS: GroundOption[] = [
    {
        id: "current",
        name: "Current",
        bg: "250 250 250",
        card: "255 255 255",
        note: "#FAFAFA ground, pure-white cards. A true neutral — no hue in either — and only five points apart, so cards barely lift off the page.",
    },
    {
        id: "cool",
        name: "Cool paper",
        bg: "246 248 252",
        card: "255 255 255",
        note: "The ground leans a few degrees toward the brand blue. Cards read as genuinely white against it, and the whole page picks up the same temperature as the brand mark without anything looking tinted.",
    },
    {
        id: "warm",
        name: "Warm paper",
        bg: "251 250 247",
        card: "255 255 255",
        note: "The same idea in the other direction — a hint of warmth, which reads calmer and more editorial. Further from the brand blue, so the two are doing different jobs.",
    },
    {
        id: "contrast",
        name: "Deeper ground",
        bg: "241 243 246",
        card: "255 255 255",
        note: "Keeps a cool bias but drops the ground further, so every card and panel separates clearly. Fixes flatness more than dullness — the strongest structural read of the four.",
    },
];

function GroundBand({ option }: { option: GroundOption }) {
    return (
        <section
            className="border-t border-border px-6 py-6"
            style={{ background: `rgb(${option.bg})` }}
        >
            <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-sm font-semibold text-foreground">{option.name}</h3>
                <code className="mono-data text-xs text-muted-foreground">
                    --background: {option.bg} · --card: {option.card}
                </code>
            </header>
            <p className="mb-4 max-w-[70ch] text-xs leading-relaxed text-muted-foreground">{option.note}</p>
            <div className="flex flex-wrap items-start gap-3">
                {/* A card, a chip row and a block of body copy — the three things
                    actually sitting on this ground all day. */}
                <div
                    className="min-w-[280px] flex-1 border border-border p-3"
                    style={{ background: `rgb(${option.card})` }}
                >
                    <div className="text-xs font-semibold text-foreground">Senior Product Manager, B2B</div>
                    <div className="mono-data text-xs text-muted-foreground">Okta · Toronto, ON, CAN · Hybrid</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className={cn(chipVariants({ active: true }), "mono-data")}>CAD 146k–200k/yr</span>
                        <span className={cn(chipVariants({ active: false }), "mono-data")}>Hybrid</span>
                        <span className={cn(chipVariants({ active: false }), "mono-data")}>6d ago</span>
                    </div>
                </div>
                <div
                    className="min-w-[280px] flex-1 border border-border p-3"
                    style={{ background: `rgb(${option.card})` }}
                >
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        Total compensation will vary based on the pay type of the position and may include
                        performance-based incentives, discretionary bonuses, as well as other perks and rewards.
                    </p>
                </div>
                <div className="flex min-w-[180px] flex-col gap-1.5">
                    <span className="mono-data text-xs font-semibold text-brand">
                        2,072,148 live roles
                    </span>
                    <span className="text-xs text-muted-foreground">on the page ground itself</span>
                </div>
            </div>
        </section>
    );
}

/* --------------------------------- page --------------------------------- */

export function SurfaceMock() {
    const [viewport, setViewport] = useState(0);
    useEffect(() => {
        const read = () => setViewport(window.innerWidth);
        read();
        window.addEventListener("resize", read);
        return () => window.removeEventListener("resize", read);
    }, []);

    return (
        <main className="min-h-screen bg-background pb-24 text-foreground">
            <div className="px-6 pt-8">
                <h1 className="text-xl font-semibold">Surface options — page width and page ground</h1>
                <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-muted-foreground">
                    Two separate calls. Everything below renders at true scale: the tinted area in each
                    width band is the actual gutter at this window size
                    {viewport > 0 && <> (currently <span className="mono-data">{viewport}px</span>)</>}, and each
                    ground band paints the whole strip so the colour is judged across a screen rather than
                    as a swatch.
                </p>
            </div>

            <h2 className="mt-8 px-6 text-xs font-semibold text-brand">
                1 · Page width — the white gutters
            </h2>
            {viewport > 0 && WIDTH_OPTIONS.map((o) => <WidthBand key={o.id} option={o} viewport={viewport} />)}

            <h2 className="mt-12 px-6 text-xs font-semibold text-brand">
                2 · Page ground — the dull white
            </h2>
            {GROUND_OPTIONS.map((o) => <GroundBand key={o.id} option={o} />)}
        </main>
    );
}
