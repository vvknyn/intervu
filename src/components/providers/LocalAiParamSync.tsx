"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { applyLocalAiSearchParam } from "@/lib/local-ai/flag";

/** Applies `?localAi=1` from any route — persists flag to localStorage. */
export function LocalAiParamSync() {
    const searchParams = useSearchParams();

    useEffect(() => {
        if (searchParams.get("localAi") === "1") {
            applyLocalAiSearchParam("1");
        }
    }, [searchParams]);

    return null;
}
