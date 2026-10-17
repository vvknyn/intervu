/**
 * Meaning-level fit between a résumé and each posting: cosine similarity of their embeddings from a
 * small open model (bge-small-en-v1.5, int8 ONNX) run by the `velai-embed` sidecar on the same
 * Contabo host (ops/velai-embed). Posting vectors are cached there by id + text, so each posting is
 * embedded once; a search waits at most `SEMANTIC_DEADLINE_MS` and the rest finish in the background.
 *
 * Why (Vivek, 2026-10-13): word and concept overlap could not tell a strong Senior PM fit from a
 * posting that merely shares vocabulary. Server-only: it needs the résumé, so it runs for a
 * signed-in account's own saved résumé (`searchJobsAction`), never for a guest's on-device one.
 */
import { createHash } from "node:crypto";
import { buildJobSearchUrl } from "@/lib/jobs/get-job";
import { host, meiliFetch, searchKey } from "@/lib/jobs/meilisearch";
import { SEMANTIC_COS_HI, SEMANTIC_COS_LO } from "@/lib/match/semantic-scale";
import type { PublicJob } from "@/lib/jobs/types";
import type { ResumeData } from "@/types/resume";

export const SEMANTIC_DEADLINE_MS = 1500;
/**
 * The most rows one search reads the meaning of: every row a pack's list reads (`FOR_YOU_READ_DEPTH`). At 150, once
 * the lists read 300 (2026-10-17), rows 151 to 300 were scored on words alone beside rows that also read meaning.
 */
export const SEMANTIC_MAX_IDS = 300;
/** The sidecar's address, or "" when none is configured: with none, a search does not look for one (`withSemanticFit`). */
const embedUrl = () => (process.env.VELAI_EMBED_URL ?? "").trim().replace(/\/+$/, "");

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** The résumé as one passage: what they do, what they did, what they know. */
export function resumeEmbedText(resume: ResumeData): string {
    const p = resume.profile ?? ({} as ResumeData["profile"]);
    const roles = (resume.experience ?? []).slice(0, 6).map((e) => `${e.role ?? ""} at ${e.company ?? ""}. ${e.description ?? ""}`);
    const skills = (resume.competencies ?? []).flatMap((c) => c.skills ?? []).slice(0, 40).join(", ");
    return [p?.profession, resume.generatedSummary, ...roles, skills ? `Skills: ${skills}` : ""].filter(Boolean).join("\n").slice(0, 4000);
}

/** Pure: a cosine from the model as a 0–1 fit (`semantic-scale.ts`). */
export function semanticFitFromCosine(cos: number): number {
    return Math.max(0, Math.min(1, (cos - SEMANTIC_COS_LO) / (SEMANTIC_COS_HI - SEMANTIC_COS_LO)));
}

async function readDescriptions(ids: string[]): Promise<Record<string, string>> {
    const h = host();
    if (!h || ids.length === 0) return {};
    const res = await meiliFetch(buildJobSearchUrl(h), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${searchKey()}` },
        body: JSON.stringify({ q: "", filter: `id IN [${ids.map((id) => JSON.stringify(id)).join(", ")}]`, limit: ids.length, attributesToRetrieve: ["id", "description"] }),
        cache: "no-store",
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { hits?: { id: string; description?: string | null }[] };
    return Object.fromEntries((body.hits ?? []).map((hit) => [hit.id, hit.description ?? ""]));
}

/**
 * `hits` with `semantic_fit` set where the sidecar answered in time; unchanged on any failure. With no
 * `VELAI_EMBED_URL` it returns at once, before reading a single description: a host without the sidecar
 * ranks on the rules alone, at no cost to the search. Reading the descriptions shares the deadline, so a
 * configured sidecar that is down or slow adds at most `deadlineMs` to a search, not the 8 s a slow
 * Meilisearch read would.
 */
export async function withSemanticFit<T extends PublicJob>(
    hits: T[],
    resume: ResumeData,
    {
        deadlineMs = SEMANTIC_DEADLINE_MS,
        fetchImpl = fetch,
        url = embedUrl(),
    }: { deadlineMs?: number; fetchImpl?: typeof fetch; url?: string } = {},
): Promise<T[]> {
    if (!url) return hits;
    const started = Date.now();
    try {
        const ids = hits.slice(0, SEMANTIC_MAX_IDS).map((hit) => hit.id);
        const queryText = resumeEmbedText(resume);
        if (ids.length === 0 || queryText.length < 40) return hits;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const descriptions = await Promise.race([
            readDescriptions(ids),
            new Promise<null>((resolve) => {
                timer = setTimeout(() => resolve(null), Math.max(300, deadlineMs - 300));
            }),
        ]).finally(() => clearTimeout(timer));
        if (!descriptions) return hits;
        const docs = hits.slice(0, SEMANTIC_MAX_IDS).map((hit) => {
            const text = `${hit.title} at ${hit.company}.\n${(descriptions[hit.id] ?? hit.description ?? "").slice(0, 3000)}`;
            return { key: `${hit.id}:${sha(text)}`, id: hit.id, text };
        });
        const left = Math.max(300, deadlineMs - (Date.now() - started));
        const res = await fetchImpl(`${url}/similarity`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ query: { key: sha(queryText), text: queryText }, docs: docs.map(({ key, text }) => ({ key, text })), deadlineMs: left - 150 }),
            signal: AbortSignal.timeout(left),
        });
        if (!res.ok) return hits;
        const { sims } = (await res.json()) as { sims?: Record<string, number> };
        if (!sims) return hits;
        const byId = new Map(docs.map((d) => [d.id, sims[d.key]] as const));
        return hits.map((hit) => {
            const cos = byId.get(hit.id);
            return typeof cos === "number" ? { ...hit, semantic_fit: Math.round(semanticFitFromCosine(cos) * 1000) / 1000 } : hit;
        });
    } catch {
        return hits;
    }
}
