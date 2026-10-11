/**
 * Sealed AI in the browser: résumé rewrites and reads go to an AI model on
 * Tinfoil's attested server (https://tinfoil.sh). Before anything is sent, the
 * `tinfoil` client checks the server's attestation (the hardware's proof of
 * which code it runs) and encrypts the request to that server's own key, so
 * only it can read the request: not velai.app's pass-through
 * (`/api/sealed-ai/v1/chat/completions`, which adds our key), not Tinfoil's
 * staff, not us. Every caller keeps a no-AI result (the rules draft, the quick
 * read) for when this is off or fails.
 */

export interface SealedAiStatus {
    enabled: boolean;
    model: string;
}

export type SealedMessage = { role: "system" | "user" | "assistant"; content: string };

export interface SealedChatOptions {
    /** Cap on the reply: every request asks for no more than it needs. */
    maxTokens: number;
    temperature?: number;
    timeoutMs?: number;
}

/** What journeys put on `window.__velaiSealedAi` in place of Tinfoil, which a test can't attest. */
export type SealedAiStub = (messages: SealedMessage[], options: SealedChatOptions) => Promise<string | null>;

const OFF: SealedAiStatus = { enabled: false, model: "" };
const DEFAULT_TIMEOUT_MS = 45_000;

function stub(): SealedAiStub | null {
    const value = (globalThis as { __velaiSealedAi?: unknown }).__velaiSealedAi;
    return typeof value === "function" ? (value as SealedAiStub) : null;
}

let statusPromise: Promise<SealedAiStatus> | null = null;

/** Is sealed AI set up on this server (`TINFOIL_API_KEY`), and with which model. Asked once per page. */
export function sealedAiStatus(): Promise<SealedAiStatus> {
    if (stub()) return Promise.resolve({ enabled: true, model: "test" });
    if (typeof window === "undefined") return Promise.resolve(OFF);
    statusPromise ??= fetch("/api/sealed-ai/status", { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<Partial<SealedAiStatus>>) : OFF))
        .then((body) => ({ enabled: body.enabled === true && typeof body.model === "string" && body.model !== "", model: String(body.model ?? "") }))
        .catch(() => OFF);
    return statusPromise;
}

type TinfoilClient = InstanceType<typeof import("tinfoil").TinfoilAI>;
let clientPromise: Promise<TinfoilClient> | null = null;

/** The verified client, loaded on first use (it brings the attestation verifier with it). */
function tinfoilClient(): Promise<TinfoilClient> {
    clientPromise ??= import("tinfoil").then(async ({ TinfoilAI }) => {
        const client = new TinfoilAI({
            // A placeholder: the pass-through puts our key in its place.
            bearerToken: "velai",
            baseURL: `${window.location.origin}/api/sealed-ai/v1/`,
        });
        await client.ready();
        return client;
    });
    // A failed check is tried again on the next request, not remembered.
    clientPromise.catch(() => {
        clientPromise = null;
    });
    return clientPromise;
}

/**
 * One chat request to the sealed model: its reply text, or null when sealed
 * AI is off, the server can't be verified, or it fails or runs out of time.
 * Never logs what was sent or received.
 */
export async function sealedChat(messages: SealedMessage[], options: SealedChatOptions): Promise<string | null> {
    const fake = stub();
    if (fake) return fake(messages, options);
    const status = await sealedAiStatus();
    if (!status.enabled) return null;
    try {
        const client = await tinfoilClient();
        const reply = await client.chat.completions.create(
            {
                model: status.model,
                messages,
                max_tokens: options.maxTokens,
                temperature: options.temperature ?? 0.2,
            },
            { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxRetries: 0 },
        );
        return reply.choices[0]?.message?.content ?? null;
    } catch (error) {
        console.warn("[sealed-ai] request not completed:", error instanceof Error ? error.name : "error");
        return null;
    }
}

export function resetSealedAiForTests(): void {
    statusPromise = null;
    clientPromise = null;
}
