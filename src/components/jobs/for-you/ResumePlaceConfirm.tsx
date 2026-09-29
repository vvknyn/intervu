"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { loaded, loadFailed, type LoadResult } from "@/lib/load-result";
import { findPlaceToConfirm, placesToConfirm, settlePlace } from "@/lib/resume/unconfirmed-place";
import type { LocationSuggestResponse } from "@/app/api/jobs/locations/route";
import type { ResumeData } from "@/types/resume";

async function readPlaces(name: string): Promise<LoadResult<string[]>> {
    try {
        const res = await fetch(`/api/jobs/locations?q=${encodeURIComponent(name)}`);
        if (!res.ok) return loadFailed(`HTTP ${res.status}`);
        return loaded(((await res.json()) as LocationSuggestResponse).places);
    } catch (e) {
        return loadFailed(e);
    }
}

/** One-tap confirm for a résumé's bare city — see `findPlaceToConfirm`. */
export function ResumePlaceConfirm({
    resume,
    onUpdateResume,
}: {
    resume: ResumeData | null;
    onUpdateResume: (resume: ResumeData) => void;
}) {
    const names = resume ? placesToConfirm(resume.profile) : [];
    const key = names.join("\n");
    const [ask, setAsk] = useState<Awaited<ReturnType<typeof findPlaceToConfirm>>>(null);

    useEffect(() => {
        let live = true;
        setAsk(null);
        void findPlaceToConfirm(names, readPlaces).then((next) => {
            if (live) setAsk(next);
        });
        return () => {
            live = false;
        };
        // `key` is the identity of `names`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    if (!resume || !ask || !names.includes(ask.name)) return null;
    const settle = (location: string) => onUpdateResume(settlePlace(resume, location));
    const [only, ...more] = ask.places;

    return (
        <div className="mb-4 space-y-2" data-testid="resume-place-confirm">
            <p className="text-sm text-foreground">
                Your résumé says “{ask.name}”. {more.length === 0 ? `Is that ${only}?` : "Which place is it?"}
            </p>
            <div className="flex flex-wrap gap-2">
                {more.length === 0 ? (
                    <Button size="sm" onClick={() => settle(only)}>
                        Yes
                    </Button>
                ) : (
                    ask.places.map((place) => (
                        <Button key={place} size="sm" variant="outline" onClick={() => settle(place)}>
                            {place}
                        </Button>
                    ))
                )}
                <Button size="sm" variant="ghost" onClick={() => settle("")}>
                    {more.length === 0 ? "No" : "None of these"}
                </Button>
            </div>
        </div>
    );
}
