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
