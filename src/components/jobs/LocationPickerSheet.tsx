"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Affordance } from "@/components/jobs/SerpFilters";
import {
    POPULAR_LOCATION_COUNTRIES,
    type LocationSheetDraft,
    type FilterState,
} from "@/components/jobs/FilterPanel";
import { pickRemoteFacetValue } from "@/components/jobs/FilterChipsRow";
import type { FacetDistribution } from "@/lib/jobs/types";
import { countryToFlag } from "@/lib/jobs/country-flag";

export function initLocationSheetDraft(
    state: FilterState,
    opts: {
        defaultedIso2?: string | null;
        locationDefaultSuppressed: boolean;
        remoteValue?: string;
    },
): LocationSheetDraft {
    const explicit = state.facets.location_country?.[0]?.trim() ?? "";
    const popular = POPULAR_LOCATION_COUNTRIES.includes(
        explicit as (typeof POPULAR_LOCATION_COUNTRIES)[number],
    );
    const remoteOn =
        opts.remoteValue != null && (state.facets.work_type ?? []).includes(opts.remoteValue);
    const canUseDetected = Boolean(opts.defaultedIso2) && !opts.locationDefaultSuppressed;
    const useDetected = canUseDetected && !explicit;

    return {
        useDetected,
        country: popular ? explicit : null,
        otherText: popular || !explicit ? "" : explicit,
        showOther: Boolean(explicit && !popular),
        remote: remoteOn,
    };
}

export function LocationPickerSheet({
    open,
    onOpenChange,
    state,
    distribution,
    defaultedIso2,
    detectedLabel,
    locationDefaultSuppressed,
    onContinue,
    onRestoreDetected,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    state: FilterState;
    distribution: FacetDistribution | undefined;
    defaultedIso2?: string | null;
    detectedLabel?: string;
    locationDefaultSuppressed: boolean;
    onContinue: (draft: LocationSheetDraft, opts: { suppressDefault: boolean }) => void;
    /** Clears the persisted "don't guess" override so the server re-applies
     *  the IP default on the next fetch (page owns the localStorage seam). */
    onRestoreDetected?: () => void;
}) {
    const remoteValue = pickRemoteFacetValue(distribution);
    const [detectedOptedIn, setDetectedOptedIn] = useState(false);
    const effectiveSuppressed = locationDefaultSuppressed && !detectedOptedIn;
    const seed = useMemo(
        () =>
            initLocationSheetDraft(state, {
                defaultedIso2,
                locationDefaultSuppressed: effectiveSuppressed,
                remoteValue,
            }),
        [state, defaultedIso2, effectiveSuppressed, remoteValue],
    );
    const [draft, setDraft] = useState<LocationSheetDraft>(seed);

    useEffect(() => {
        if (open) setDraft(seed);
    }, [open, seed]);

    const canUseDetected = Boolean(defaultedIso2 || detectedLabel) && !effectiveSuppressed;

    const selectDetected = () => {
        setDetectedOptedIn(true);
        setDraft((d) => ({
            ...d,
            useDetected: true,
            country: null,
            showOther: false,
            otherText: "",
        }));
    };

    const selectCountry = (country: string) => {
        setDraft((d) => ({
            ...d,
            useDetected: false,
            country,
            showOther: false,
            otherText: "",
        }));
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                className="mx-auto max-h-[85dvh] w-full max-w-[720px] overflow-hidden rounded-t-[18px] border-border p-0"
            >
                <SheetTitle className="sr-only">Location</SheetTitle>
                <div className="max-h-[85dvh] overflow-y-auto overscroll-contain bg-card p-4 pb-[env(safe-area-inset-bottom,16px)]">
                    <h3 className="text-sm font-semibold text-foreground">Where do you want to work?</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Pick one or more — results update when you continue.</p>

                    <div className="mt-4 flex flex-col gap-2">
                        {locationDefaultSuppressed && !detectedOptedIn && (
                            <Affordance
                                testId="location-sheet-restore-detected"
                                active={false}
                                onClick={() => {
                                    setDetectedOptedIn(true);
                                    onRestoreDetected?.();
                                }}
                            >
                                Use detected location
                            </Affordance>
                        )}
                        {canUseDetected && (
                            <Affordance
                                testId="location-sheet-detected"
                                active={draft.useDetected}
                                onClick={selectDetected}
                            >
                                {detectedLabel ?? "Use detected location"}
                            </Affordance>
                        )}

                        {remoteValue != null && (
                            <Affordance
                                testId="location-sheet-remote"
                                active={draft.remote}
                                onClick={() => setDraft((d) => ({ ...d, remote: !d.remote }))}
                            >
                                Remote
                            </Affordance>
                        )}

                        {POPULAR_LOCATION_COUNTRIES.map((country) => (
                            <Affordance
                                key={country}
                                testId={`location-sheet-country-${country.replace(/\s+/g, "-").toLowerCase()}`}
                                active={!draft.useDetected && draft.country === country}
                                onClick={() => selectCountry(country)}
                            >
                                <span className="inline-flex items-center gap-2">
                                    {countryToFlag(country) && (
                                        <span aria-hidden>{countryToFlag(country)}</span>
                                    )}
                                    {country}
                                </span>
                            </Affordance>
                        ))}

                        <Affordance
                            testId="location-sheet-other"
                            active={draft.showOther}
                            onClick={() =>
                                setDraft((d) => ({
                                    ...d,
                                    useDetected: false,
                                    country: null,
                                    showOther: !d.showOther,
                                }))
                            }
                        >
                            Other
                        </Affordance>

                        {draft.showOther && (
                            <Input
                                data-testid="location-sheet-other-input"
                                type="text"
                                placeholder="Country or city"
                                value={draft.otherText}
                                onChange={(e) =>
                                    setDraft((d) => ({ ...d, otherText: e.target.value, useDetected: false }))
                                }
                                className="h-11 rounded-none border-border bg-background text-base"
                            />
                        )}
                    </div>

                    <Button
                        type="button"
                        data-testid="location-sheet-continue"
                        className="mt-5 h-11 w-full rounded-none bg-foreground text-xs font-bold uppercase tracking-wider text-background hover:bg-foreground/90"
                            onClick={() => {
                                const suppressDefault =
                                    !draft.useDetected && Boolean(draft.country || draft.otherText.trim());
                                onContinue(draft, { suppressDefault });
                            }}
                    >
                        Continue
                    </Button>
                </div>
            </SheetContent>
        </Sheet>
    );
}
