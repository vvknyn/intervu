"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Company names sometimes carry a leading req/location code (e.g. "USA102 Acme Inc"). Strip it. */
function cleanCompany(s: string | null | undefined): string {
    if (!s) return "";
    let decoded = s;
    if (decoded.includes("%")) {
        try {
            decoded = decodeURIComponent(decoded);
        } catch {
            decoded = decoded.replace(/%20/g, " ");
        }
    }
    return decoded.replace(/^[A-Z]{2,5}\d{2,6}\s+/, "").trim();
}

function companyInitial(name: string | null): string {
    const n = cleanCompany(name).trim();
    return n ? n[0].toUpperCase() : "?";
}

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
            className={cn(
                "flex shrink-0 items-center justify-center rounded-xl font-display text-lg font-bold",
                className,
            )}
            style={{ background: pair.bg, color: pair.fg }}
        >
            {initial}
        </div>
    );
}

const SIZE_CLS: Record<"sm" | "lg", string> = {
    sm: "h-11 w-11 rounded-xl text-base",
    lg: "h-14 w-14 rounded-2xl text-xl",
};

/**
 * Single chokepoint for company logos across /jobs. Renders a favicon fetched
 * off `company_domain` when available, falling back to the existing
 * single-letter initial tile on a null domain or a failed image load.
 */
export function CompanyLogo({
    domain,
    name,
    size,
}: {
    domain: string | null;
    name: string | null;
    size: "sm" | "lg";
}) {
    const [errored, setErrored] = useState(false);
    const showImage = Boolean(domain) && !errored;

    return (
        <div
            className={cn(
                "flex shrink-0 items-center justify-center bg-brand/10 font-bold text-brand",
                SIZE_CLS[size],
            )}
        >
            {showImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain as string)}&sz=128`}
                    alt={`${name ?? "Company"} logo`}
                    loading="lazy"
                    className="h-full w-full rounded-[inherit] object-contain p-1.5"
                    onError={() => setErrored(true)}
                />
            ) : (
                companyInitial(name)
            )}
        </div>
    );
}
