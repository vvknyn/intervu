"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Affordance } from "@/components/jobs/SerpFilters";
import {
    POPULAR_LOCATION_COUNTRIES,
    type LocationSheetDraft,
    type FilterState,
} from "@/components/jobs/FilterPanel";
import { pickRemoteFacetValue } from "@/components/jobs/FilterChipsRow";
import type { FacetDistribution } from "@/lib/jobs/types";
import { countryToFlag } from "@/lib/jobs/country-flag";
import { addLocationValue, hasLocationValue, removeLocationValue } from "@/lib/jobs/location-suggest";

export function initLocationSheetDraft(
    state: FilterState,
    opts: {
        defaultedIso2?: string | null;
        locationDefaultSuppressed: boolean;
        remoteValue?: string;
    },
): LocationSheetDraft {
    // EVERY committed place, not `[0]`. Reading the first one made the sheet
    // show "Canada" to someone filtering on Canada + Toronto + Remote, and
    // then replace all three with whatever they picked.
    const places = (state.facets.location_country ?? []).map((v) => v.trim()).filter(Boolean);
    const remoteOn =
        opts.remoteValue != null && (state.facets.work_type ?? []).includes(opts.remoteValue);
    const canUseDetected = Boolean(opts.defaultedIso2) && !opts.locationDefaultSuppressed;
    const useDetected = canUseDetected && places.length === 0;

    // The free-text row starts empty and closed even when a non-popular place
    // is committed: it is now the "add another" input, and the committed place
    // renders as its own toggle row instead. Pre-filling it would offer to
    // EDIT one member of a list, which is the single-value model again.
    return {
        useDetected,
        places,
        otherText: "",
        showOther: false,
        remote: remoteOn,
    };
}

/** The chosen places that have no row of their own in the popular list —
 *  cities, regions, anything typed. Rendered above the popular countries so
 *  what the sheet shows as chosen is the whole filter, not part of it. */
export function extraChosenPlaces(places: readonly string[]): string[] {
    return places.filter((p) => !hasLocationValue(POPULAR_LOCATION_COUNTRIES, p));
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
    const seed = initLocationSheetDraft(state, {
        defaultedIso2,
        locationDefaultSuppressed: effectiveSuppressed,
        remoteValue,
    });
    const [draft, setDraft] = useState<LocationSheetDraft>(seed);

    /**
     * Re-seed the draft on the OPEN transition only.
     *
     * `state` is `filterState`, an object rebuilt on every render of the page
     * above us, so it is a new reference each time that page renders for any
     * reason — a search landing, a keystroke elsewhere. This used to be an
     * effect depending on a `useMemo` keyed on it, which therefore fired on
     * those renders and overwrote the draft with committed state: the user's
     * taps vanished mid-selection. Invisible when the draft held one country;
     * with a list it discards the whole selection.
     *
     * Same root defect as the 2026-08-24 SERP render loop (an unstable object
     * reaching a dependency array); it merely converged here because
     * `setDraft` writes local state and so does not re-render the parent that
     * rebuilds the object.
     *
     * Comparing against the previous `open` is React's own documented answer
     * for "adjust state when a prop changes" — it keys off the transition
     * itself rather than off any object's identity, so no amount of churn
     * upstream can reach it. React re-renders immediately without committing
     * the discarded output, so this costs less than the effect it replaces.
     */
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setDraft(seed);
    }

    const canUseDetected = Boolean(defaultedIso2 || detectedLabel) && !effectiveSuppressed;

    const selectDetected = () => {
        setDetectedOptedIn(true);
        setDraft((d) => ({
            ...d,
            useDetected: true,
            places: [],
            showOther: false,
            otherText: "",
        }));
    };

    /** Add or drop one place. Folded-compared through the same helpers the
     *  desktop picker uses, so "Montreal" and "Montréal" are one row's worth
     *  of state on both surfaces. */
    const togglePlace = (place: string) => {
        setDraft((d) => ({
            ...d,
            useDetected: false,
            places: hasLocationValue(d.places, place)
                ? removeLocationValue(d.places, place)
                : addLocationValue(d.places, place),
        }));
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                className="mx-auto w-full max-w-[720px] border-border p-0"
            >
                <SheetTitle className="sr-only">Location</SheetTitle>
                <SheetBody className="bg-surface p-4 pb-[env(safe-area-inset-bottom,16px)]">
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

                        {/* Chosen places with no row of their own — a typed city, a
                            region. Rendered first and already active, so opening the
                            sheet shows the WHOLE filter rather than the part of it
                            that happens to be a popular country. Tapping removes. */}
                        {extraChosenPlaces(draft.places).map((place) => (
                            <Affordance
                                key={place}
                                testId={`location-sheet-chosen-${place.replace(/\s+/g, "-").toLowerCase()}`}
                                active
                                onClick={() => togglePlace(place)}
                            >
                                {place}
                            </Affordance>
                        ))}

                        {POPULAR_LOCATION_COUNTRIES.map((country) => (
                            <Affordance
                                key={country}
                                testId={`location-sheet-country-${country.replace(/\s+/g, "-").toLowerCase()}`}
                                active={!draft.useDetected && hasLocationValue(draft.places, country)}
                                onClick={() => togglePlace(country)}
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
                                aria-label="Location"
                                placeholder="Country or city"
                                value={draft.otherText}
                                onChange={(e) =>
                                    setDraft((d) => ({ ...d, otherText: e.target.value, useDetected: false }))
                                }
                                className="h-11 rounded-ctl border-border bg-background text-base"
                            />
                        )}
                    </div>

                    <Button
                        type="button"
                        data-testid="location-sheet-continue"
                        className="mt-5 h-11 w-full rounded-ctl bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary"
                            onClick={() => {
                                const suppressDefault =
                                    !draft.useDetected &&
                                    (draft.places.length > 0 || Boolean(draft.otherText.trim()));
                                onContinue(draft, { suppressDefault });
                            }}
                    >
                        Continue
                    </Button>
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}
