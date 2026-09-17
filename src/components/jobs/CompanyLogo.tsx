"use client";

import { useState } from "react";
import { companyLogoUrl, shouldShowFavicon } from "@/lib/companies/logo";
import { cn } from "@/lib/utils";
// The shared chokepoint (lib/jobs/presentation.ts) — this file used to carry
// its own private copy with a subset of the rules (URI-decode + req-code
// strip); the canonical one now covers both plus tenant codes and duplicate
// parentheticals, so the logo initial can never disagree with the row text.
import { cleanCompany } from "@/lib/jobs/presentation";

/**
 * Company-initial tile palette (portal redesign spec) — a fixed set of
 * bg/fg pastel pairs, deliberately raw hex: the spec calls these out as the
 * one explicit exception to "tokens only," since they're the design's own
 * fixed chip palette rather than theme-driven surface colors. Same pairs in
 * both themes (spec: "they read as pastel chips" either way).
 */
const TILE_PALETTE: { bg: string; fg: string }[] = [
    { bg: "#E8EDF6", fg: "#2B4A7E" },
    { bg: "#EFE8F6", fg: "#5B3A8E" },
    { bg: "#E6F1EC", fg: "#0E6B4C" },
    { bg: "#F6EDE4", fg: "#8E5B2B" },
    { bg: "#F6E8E8", fg: "#8E2B2B" },
    { bg: "#EDEBE2", fg: "#3E3B30" },
];

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

/**
 * Deterministic pastel initial tile for job-CARD rows (find-jobs list) — a
 * fixed letter + palette pair hashed from the company name, distinct from
 * `CompanyLogo` below (favicon-first, used in the job-detail panel). One
 * company name always maps to the same pair.
 */
export function CompanyInitialTile({ name, className }: { name: string | null; className?: string }) {
    const clean = cleanCompany(name);
    const initial = clean ? clean[0].toUpperCase() : "?";
    const pair = TILE_PALETTE[hashString(clean || "?") % TILE_PALETTE.length];
    return (
        <div
            data-rulebook-exempt
            className={cn(
                "flex shrink-0 items-center justify-center rounded-xl font-display text-lg font-semibold",
                className,
            )}
            style={{ background: pair.bg, color: pair.fg }}
        >
            {initial}
        </div>
    );
}

const SIZE_CLS: Record<"xs" | "sm" | "md" | "lg", string> = {
    xs: "h-7 w-7 rounded-xl text-xs",
    sm: "h-9 w-9 rounded-xl text-sm",
    // SERP job-card tile size — restored to h-12/rounded-xl to match the
    // JobCardSkeleton slot so loading → loaded doesn't shift the row.
    md: "h-12 w-12 rounded-xl text-base",
    lg: "h-14 w-14 rounded-xl text-xl",
};

/**
 * Single chokepoint for company logos across /jobs. Renders a favicon fetched
 * off `company_domain` when available, falling back to `CompanyInitialTile`
 * (pastel letter tile) on a null domain or a failed image load. Both paths
 * share the same SIZE_CLS container so the row slot never shifts.
 */
export function CompanyLogo({
    domain,
    name,
    size,
}: {
    domain: string | null;
    name: string | null;
    size: "xs" | "sm" | "md" | "lg";
}) {
    const [errored, setErrored] = useState(false);
    const showImage = shouldShowFavicon(domain, errored);

    const sizeCls = SIZE_CLS[size];
    // The index carries the ATS-stated raw name (intervu owns display-time
    // cleaning, not ingest) — the `alt` text below renders straight into the
    // DOM regardless of whether the favicon loads, so it needs the same
    // cleaning CompanyInitialTile already applies to the fallback initial.
    const cleanedName = cleanCompany(name);

    if (!showImage) {
        return (
            <CompanyInitialTile
                name={cleanedName}
                className={cn(
                    "border border-border dark:border-border",
                    sizeCls,
                )}
            />
        );
    }

    return (
        <div
            className={cn(
                "flex shrink-0 items-center justify-center overflow-hidden border border-border bg-white dark:border-border dark:bg-border",
                sizeCls,
            )}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={companyLogoUrl(domain as string)}
                alt={`${cleanedName || "Company"} logo`}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setErrored(true)}
                className="h-full w-full object-contain p-1"
            />
        </div>
    );
}
