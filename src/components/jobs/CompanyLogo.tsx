"use client";

import { useState } from "react";
import { companyLogoUrl, shouldShowFavicon } from "@/lib/companies/logo";
import { cn } from "@/lib/utils";
// The shared chokepoint (lib/jobs/presentation.ts) — this file used to carry
// its own private copy with a subset of the rules (URI-decode + req-code
// strip); the canonical one now covers both plus tenant codes and duplicate
// parentheticals, so the logo initial can never disagree with the row text.
import { cleanCompany } from "@/lib/jobs/presentation";

/** Deterministic initial-tile pairs hashed from company name — poster tints only. */
const TILE_VARIANT_CLASS = [
    "bg-surface-2 text-foreground",
    "bg-surface-3 text-muted-foreground",
    "bg-live-tint-bg text-verdict-live",
    "bg-brand-tint-bg text-brand",
    "bg-verdict-caution-bg text-verdict-caution",
    "bg-chip text-faint",
] as const;

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
    const variant = TILE_VARIANT_CLASS[hashString(clean || "?") % TILE_VARIANT_CLASS.length];
    return (
        <div
            className={cn(
                "flex shrink-0 items-center justify-center rounded-panel text-lg font-semibold",
                variant,
                className,
            )}
        >
            {initial}
        </div>
    );
}

const SIZE_CLS: Record<"xs" | "sm" | "md" | "lg", string> = {
    xs: "h-7 w-7 rounded-panel text-xs",
    sm: "h-9 w-9 rounded-panel text-sm",
    // SERP job-card tile size — restored to h-12/rounded-panel to match the
    // JobCardSkeleton slot so loading → loaded doesn't shift the row.
    md: "h-12 w-12 rounded-panel text-base",
    lg: "h-14 w-14 rounded-panel text-xl",
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
                className={cn("border border-border", sizeCls)}
            />
        );
    }

    return (
        <div
            className={cn(
                "flex shrink-0 items-center justify-center overflow-hidden border border-border bg-surface-2 shadow-[var(--shadow-bevel-inset)]",
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
