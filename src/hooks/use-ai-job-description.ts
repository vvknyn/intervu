"use client";

import { useEffect, useMemo, useState } from "react";
import {
    canUseOnDeviceJdFormat,
    enhanceJdTemplateWithLocalAi,
    jdTemplateHasContent,
    resolveJdTemplateSync,
    type JdTemplate,
} from "@/lib/local-ai/format-job-description";

export type JdFormatSource = "cache" | "deterministic" | "ai" | "empty";

export interface UseAiJobDescriptionResult {
    template: JdTemplate;
    source: JdFormatSource;
    /** True while an on-device upgrade is in flight (baseline template already shown). */
    enhancing: boolean;
    hasContent: boolean;
}

/**
 * Progressive JD template for postcard / detail bodies.
 *
 * 1. Sync: cache hit or deterministic template (never blocks).
 * 2. Async: on-device AI upgrade when local-AI enabled + consented.
 * 3. Fail soft: AI miss keeps the baseline; empty only when source was empty.
 */
export function useAiJobDescription(
    jobId: string | null | undefined,
    description: string | null | undefined,
): UseAiJobDescriptionResult {
    const baseline = useMemo(
        () => resolveJdTemplateSync(jobId, description),
        [jobId, description],
    );

    const [template, setTemplate] = useState<JdTemplate>(baseline.template);
    const [source, setSource] = useState<JdFormatSource>(baseline.source);
    const [enhancing, setEnhancing] = useState(false);

    // Reset to sync baseline whenever the job/description changes.
    useEffect(() => {
        setTemplate(baseline.template);
        setSource(baseline.source);
        setEnhancing(false);
    }, [baseline]);

    useEffect(() => {
        if (!jobId || !description?.trim()) return;
        if (baseline.source === "cache") return; // already AI-shaped
        if (!canUseOnDeviceJdFormat()) return;

        let cancelled = false;
        setEnhancing(true);

        void enhanceJdTemplateWithLocalAi(jobId, description, baseline.template).then((upgraded) => {
            if (cancelled) return;
            setEnhancing(false);
            if (upgraded && jdTemplateHasContent(upgraded)) {
                setTemplate(upgraded);
                setSource("ai");
            }
        });

        return () => {
            cancelled = true;
        };
    }, [jobId, description, baseline]);

    return {
        template,
        source,
        enhancing,
        hasContent: jdTemplateHasContent(template),
    };
}
