/**
 * What made a draft or a read: sealed AI (src/lib/sealed-ai/client.ts) or the
 * rules alone. The on-device models are gone (Vivek 2026-10-11: "get rid of
 * the local model and use tinfoil").
 */
export type LocalAiEngineId = "sealed" | "heuristic";

export const ENGINE_LABELS: Record<LocalAiEngineId, string> = {
    sealed: "Sealed AI · Tinfoil",
    heuristic: "Rules",
};

/** Raw JSON-ish object from a model before shared normalization. */
export type ModelParseOutput = Record<string, unknown> | null;
