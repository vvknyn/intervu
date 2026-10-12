"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBar, SheetBody, SheetContent } from "@/components/ui/sheet";
import { Affordance } from "@/components/jobs/SerpFilters";
import { LocationCombobox } from "@/components/jobs/LocationCombobox";
import {
    POPULAR_LOCATION_COUNTRIES,
    type LocationSheetDraft,
    type FilterState,
} from "@/components/jobs/FilterPanel";
import { pickRemoteFacetValue } from "@/components/jobs/FilterChipsRow";
import type { FacetDistribution } from "@/lib/jobs/types";
import { countryToFlag } from "@/lib/jobs/country-flag";
import {
    addLocationValue,
    hasLocationValue,
    removeLocationValue,
    type SuggestField,
} from "@/lib/jobs/location-suggest";
import { LOCATION_FACET_FIELDS } from "@/lib/jobs/meilisearch";

/** What Continue hands the page: whether the IP default stops applying, and
 *  the place picked from the sheet's search box when that is how it closed. */
export type LocationSheetContinueOpts = {
    suppressDefault: boolean;
    pick?: { value: string; field?: SuggestField };
};

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

    // The search box starts empty even when a non-popular place is
    // committed: it is the "add another" input, and the committed place
    // renders as its own toggle row instead. Pre-filling it would offer to
    // EDIT one member of a list, which is the single-value model again.
    return {
        useDetected,
        places,
        otherText: "",
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
    onContinue: (draft: LocationSheetDraft, opts: LocationSheetContinueOpts) => void;
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
            otherText: "",
        }));
    };

    /** Places already filtered on, in any location field, so the search
     *  box's rows can show which ones are chosen. */
    const chosen = [
        ...draft.places,
        ...LOCATION_FACET_FIELDS.filter((f) => f !== "location_country").flatMap((f) => state.facets[f] ?? []),
    ];

    /** A row picked (or Enter on typed text) in the search box applies at
     *  once, like the desktop box: one place is the common answer, and the
     *  rest of the draft (Remote, ticked countries) goes with it. */
    const continueWith = (pick?: LocationSheetContinueOpts["pick"]) => {
        const suppressDefault =
            Boolean(pick) ||
            (!draft.useDetected && (draft.places.length > 0 || Boolean(draft.otherText.trim())));
        const committed = pick ? { ...draft, useDetected: false, otherText: "" } : draft;
        onContinue(committed, pick ? { suppressDefault, pick } : { suppressDefault });
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
                hideCloseButton
                className="mx-auto w-full max-w-[720px] gap-0 border-border border-b-0 p-0"
            >
                <SheetBar title="Where do you want to work?" description="Type a city or region, or tick one or more below." />
                <SheetBody className="p-4 pb-[env(safe-area-inset-bottom,16px)]">
                    {/* The same search as the desktop location box, at the top:
                        a phone had only eleven country rows and an "Other" row
                        to open before it could name a city, so a nurse in
                        Calgary picked Canada and got Edmonton and Hamilton
                        (focus group, 2026-10-12). */}
                    <LocationCombobox
                        inline
                        commitOnBlur={false}
                        data-testid="location-sheet-input"
                        value={draft.otherText}
                        onChange={(text) => setDraft((d) => ({ ...d, otherText: text, useDetected: text ? false : d.useDetected }))}
                        onCommit={(value, field) => continueWith({ value, field })}
                        selected={chosen}
                        placeholder="Type a city, state, or country"
                        containerClassName="mb-4"
                        className="ctl-lg rounded-ctl border-border bg-card text-base"
                    />
                    <div className="flex flex-col gap-2">
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
                    </div>

                    <Button
                        type="button"
                        data-testid="location-sheet-continue"
                        className="mt-5 w-full bg-primary text-primary-foreground hover:bg-primary"
                        onClick={() => continueWith()}
                    >
                        Continue
                    </Button>
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}
