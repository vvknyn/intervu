"use client";

import { useEffect, useState } from "react";
import { readLocalAiResume } from "@/lib/local-ai/resume-storage";
import { resumeIsUsable } from "@/lib/resume/resume-usable";
import { useResumePresence } from "@/lib/resume/use-resume-presence";
import { connectTabLabel } from "@/components/layout/nav-tabs";

function readLocalResumeConnected(): boolean {
    if (typeof window === "undefined") return false;
    const stored = readLocalAiResume();
    return stored != null && resumeIsUsable(stored.data);
}

/** Desktop/mobile Connect tab label from local or account résumé presence. */
export function useConnectTabLabel(uid: string | null | undefined, authReady: boolean): string {
    const resumeOnFile = useResumePresence(uid ?? null, authReady);
    const [localConnected, setLocalConnected] = useState(readLocalResumeConnected);

    useEffect(() => {
        setLocalConnected(readLocalResumeConnected());
    }, [uid, resumeOnFile]);

    return connectTabLabel(localConnected || resumeOnFile === true);
}
