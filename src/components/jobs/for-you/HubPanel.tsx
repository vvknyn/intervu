"use client";

/**
 * The sections under the pack chips on the packs home (Today, Your tracker,
 * Recently viewed) are each one panel: the welcome panel's surface and
 * border, a header row with its title and one link, and the section's rows
 * inside. Their numbers are tiles, each a link to the rows it counts, so a
 * number never runs into the text around it (Vivek, 2026-10-01: "the 'your
 * tracker' numbers just merge in with the rest of the text").
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { SectionTitle } from "@/components/ui/heading";
import { WaitBar } from "@/components/ui/wait-state";
import { cn } from "@/lib/utils";

export function HubPanel({
    id,
    title,
    titleId,
    testId,
    link,
    intro,
    className,
    children,
}: {
    id?: string;
    title: string;
    titleId: string;
    testId: string;
    /** The header's one link or button, right-aligned. */
    link?: ReactNode;
    /** Lines under the title: what the section is based on. */
    intro?: ReactNode;
    className?: string;
    children: ReactNode;
}) {
    return (
        <section
            id={id}
            aria-labelledby={titleId}
            data-testid={testId}
            className={cn(
                "scroll-mt-24 rounded-panel border border-border bg-surface py-5 shadow-[var(--shadow-bevel-highlight)]",
                className,
            )}
        >
            <header className="space-y-1 poster-list-inset-x">
                <div className="flex items-baseline justify-between gap-3">
                    <SectionTitle id={titleId}>{title}</SectionTitle>
                    {link ? <div className="shrink-0 text-sm">{link}</div> : null}
                </div>
                {intro}
            </header>
            {children}
        </section>
    );
}

/** The header link's look: plain brand text. */
export const HUB_PANEL_LINK_CLASS =
    "text-sm text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

/** A row of number tiles: two across on a phone, all of them in one row from sm up. */
export function HubStatTiles({
    testId,
    label,
    count,
    children,
}: {
    testId: string;
    label: string;
    /** How many tiles: three or four share the row from sm up. */
    count: 3 | 4;
    children: ReactNode;
}) {
    return (
        <ul
            aria-label={label}
            data-testid={testId}
            className={cn("mt-4 grid grid-cols-2 gap-2 poster-list-inset-x", count === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4")}
        >
            {children}
        </ul>
    );
}

/**
 * One number and what it counts. With `href` the whole tile is the link to
 * those rows; a zero links nowhere (there is nothing to open).
 */
export function HubStatTile({
    testId,
    href,
    value,
    suffix,
    label,
    tone,
    onClick,
}: {
    testId: string;
    href?: string | null;
    /** `null` while the number is still loading. */
    value: string | null;
    suffix?: string;
    label: string;
    tone?: "brand" | "warn";
    onClick?: () => void;
}) {
    const body = (
        <>
            <span
                className={cn(
                    "block text-2xl font-semibold leading-tight tabular-nums",
                    tone === "brand" ? "text-brand" : tone === "warn" ? "text-warn" : "text-foreground",
                )}
            >
                {value == null ? (
                    <WaitBar className="my-1.5 h-5 w-8" aria-hidden />
                ) : (
                    <>
                        {value}
                        {suffix ? <span className="text-sm font-normal text-muted-foreground"> {suffix}</span> : null}
                    </>
                )}
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground underline-offset-2 group-hover:text-foreground group-hover:underline">
                {label}
            </span>
        </>
    );
    const tile = "block h-full rounded-ctl border border-border bg-surface-2 px-3 py-2.5";
    if (!href) {
        return (
            <li data-testid={testId}>
                <div className={tile}>{body}</div>
            </li>
        );
    }
    const linkClass = cn(
        tile,
        "group transition-colors duration-150 hover:border-brand hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
    );
    return (
        <li data-testid={testId}>
            {href.startsWith("#") ? (
                <a href={href} className={linkClass} onClick={onClick}>
                    {body}
                </a>
            ) : (
                <Link href={href} className={linkClass} onClick={onClick}>
                    {body}
                </Link>
            )}
        </li>
    );
}
