import test from "node:test";
import assert from "node:assert/strict";
import { ProviderFactory } from "@/lib/llm/providers";

process.env.NEXT_PUBLIC_SITE_URL ??= "https://velai.test";

async function bodyFor(provider: string, model: string): Promise<Record<string, unknown>> {
    const p = ProviderFactory.getProvider(provider, "k", model) as unknown as {
        client: { chat: { completions: { create: (b: Record<string, unknown>) => Promise<unknown> } } };
        generate: (r: { prompt: string }) => Promise<unknown>;
    };
    let sent: Record<string, unknown> = {};
    p.client.chat.completions.create = async (b) => {
        sent = b;
        return { choices: [{ message: { content: "ok" } }] };
    };
    await p.generate({ prompt: "hi" });
    return sent;
}

test("OpenRouter requests carry provider.zdr=true for any model", async () => {
    for (const m of ["deepseek/deepseek-v4-flash", "other/model-x"]) {
        assert.deepEqual((await bodyFor("openrouter", m)).provider, { zdr: true });
    }
});

test("any other provider name still goes to OpenRouter with ZDR: there is no non-ZDR lane", async () => {
    for (const name of ["groq", "anything-else"]) {
        assert.deepEqual((await bodyFor(name, "llama-x")).provider, { zdr: true });
    }
});
