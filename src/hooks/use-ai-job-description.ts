"use client";

import { useMemo } from "react";
import { jdTemplateHasContent, resolveJdTemplateSync, type JdTemplate } from "@/lib/local-ai/format-job-description";

export type JdFormatSource = "deterministic" | "empty";

export interface UseAiJobDescriptionResult {
    template: JdTemplate;
    source: JdFormatSource;
    hasContent: boolean;
}

/** The postcard's description template: the posting's own blocks by heading, rules only. */
export function useAiJobDescription(description: string | null | undefined): UseAiJobDescriptionResult {
    return useMemo(() => {
        const { template, source } = resolveJdTemplateSync(description);
        return { template, source, hasContent: jdTemplateHasContent(template) };
    }, [description]);
}
