"use client";

import { useEffect, useState } from "react";
import { readLocalAiResume } from "@/lib/local-ai/resume-storage";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { useResumePresence } from "@/lib/resume/use-resume-presence";
import { resumeTabLabel } from "@/components/layout/nav-tabs";

function readLocalResumeConnected(): boolean {
    const stored = readLocalAiResume();
    return stored != null && resumeIsUsable(stored.data);
}

/** Desktop/mobile Résumé tab label from local or account résumé presence. */
export function useResumeTabLabel(uid: string | null | undefined, authReady: boolean): string {
    const signedIn = authReady && !!uid;
    const resumeOnFile = useResumePresence(uid ?? null, authReady);
    // Starts false, as the server HTML renders it: a first-render read of the
    // browser-held résumé hydrates "Résumé & AI" against server-rendered "Add résumé" (React #418).
    const [localConnected, setLocalConnected] = useState(false);

    useEffect(() => {
        setLocalConnected(readLocalResumeConnected());
    }, [uid, resumeOnFile]);

    const localGuestConnected = !signedIn && localConnected;
    return resumeTabLabel((signedIn && resumeOnFile === true) || localGuestConnected);
}
