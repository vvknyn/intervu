export const DEFAULT_PROVIDER = "openrouter";
// App-provided default. A stable, cheap, JSON-reliable model on the shared OpenRouter key.
// (Replaced the free `owl-alpha` stealth model, which proved unstable — started 400-ing.)
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

export const AVAILABLE_MODELS = {
    openrouter: [
        { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", description: "Default — fast, very cheap, 1M context", category: "Paid" as const },
        { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", description: "Higher quality, pricier", category: "Paid" as const },
        { id: "openai/gpt-4o-mini", name: "GPT-4o mini", description: "Fast & cheap, reliable JSON", category: "Paid" as const },
        { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", description: "Very fast, low cost", category: "Paid" as const },
        { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku", description: "Fast, high quality", category: "Paid" as const },
    ],
    groq: [
        { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", description: "Versatile, very fast", category: "Free" as const },
        { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", description: "Fastest, lightweight", category: "Free" as const },
        { id: "gemma2-9b-it", name: "Gemma2 9B", description: "Lightweight", category: "Free" as const },
    ],
} as const;

/**
 * Free rungs tried before the paid default, for résumé parsing only.
 *
 * Uploading a résumé sends ~8K characters through the shared, app-funded key
 * on every attempt, and the task — pull structured fields out of a document —
 * is one free models are good at. Ordered most-capable first.
 *
 * **Ordered by measured latency, not by parameter count.** Every free model
 * below was smoke-tested 2026-08-17 against this exact prompt on a real
 * résumé, and all of them extracted every field correctly (name, profession,
 * years, email, location, 2 roles, 1 degree, 2 skill groups). Capability was
 * not the differentiator; speed was, by a factor of seven:
 *
 *   dots-studio/dots-3-note-preview:free      15.0s  ✓ all fields
 *   nvidia/nemotron-nano-9b-v2:free           17.0s  ✓ all fields
 *   openrouter/free                           26.6s  ✓ all fields
 *   nvidia/nemotron-3-super-120b-a12b:free    46.3s  ✓ all fields
 *   openai/gpt-oss-20b:free                   59.3s  ✓ all fields
 *   google/gemma-4-26b-a4b-it:free            429 rate-limited (130ms)
 *   deepseek/deepseek-v4-flash (paid tail)     7.6s  ✓ all fields
 *
 * Someone is watching a spinner on their own résumé, so a 46s free model is
 * not "the cheap option", it is a worse product. The two fastest are the only
 * ones worth a rung. `liquid/lfm-2.5-2.6b:free` was faster still (8.9s) and
 * also correct, but it is a 2.6B model and this sample was one clean résumé —
 * not enough evidence to lead with it on the messy PDF text this path actually
 * receives.
 *
 * Selection criteria before the latency test, checked live against
 * `openrouter.ai/api/v1/models`: prompt AND completion priced at 0,
 * `response_format` in `supported_parameters` (the prompt asks for
 * `json_object`), and context far above the 8K cap in `parseResumeWithAI`.
 *
 * `:free` slugs come and go — OpenRouter withdrew `deepseek-v4-flash:free`
 * once already, gemma above is rate-limited today, and a withdrawn slug is a
 * dead rung costing a round-trip. Re-measure before adding one, and never let
 * this list stand alone: `resolveModelLadder` appends the paid model as the
 * final rung precisely so a withdrawn or throttled free tier degrades to
 * today's behaviour instead of to a broken upload.
 */
export const RESUME_PARSE_FREE_LADDER = [
    "dots-studio/dots-3-note-preview:free", // 512K ctx, response_format + structured outputs
    "nvidia/nemotron-nano-9b-v2:free",      // 128K ctx, response_format + structured outputs
] as const;

export type Provider = keyof typeof AVAILABLE_MODELS;
export type Model = { id: string; name: string; description: string; category: "Free" | "Paid" };

export const PROVIDERS = [
    { id: "openrouter", name: "OpenRouter", description: "Default model included — or add your own key" },
    { id: "groq", name: "Groq", description: "Bring your own free Groq key — fastest inference" },
] as const;
