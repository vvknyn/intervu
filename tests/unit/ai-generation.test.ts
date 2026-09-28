import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeLlmFeature,
  sanitizeDistinctId,
  buildAiGenerationProperties,
  captureAiGeneration,
} from "../../src/lib/analytics/ai-generation";

const ORIGINAL_ENV = {
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
};
const ORIGINAL_FETCH = global.fetch;

const PLANTED_PROMPT = "PLANTED_PROMPT_SENTENCE_DO_NOT_CAPTURE";
const PLANTED_RESPONSE = "PLANTED_RESPONSE_SENTENCE_DO_NOT_CAPTURE";

function setEnv(overrides: { key?: string; host?: string; siteUrl?: string }) {
  if (overrides.key === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  else process.env.NEXT_PUBLIC_POSTHOG_KEY = overrides.key;
  if (overrides.host === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
  else process.env.NEXT_PUBLIC_POSTHOG_HOST = overrides.host;
  if (overrides.siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = overrides.siteUrl;
}

function restoreEnv() {
  setEnv({
    key: ORIGINAL_ENV.key,
    host: ORIGINAL_ENV.host,
    siteUrl: ORIGINAL_ENV.siteUrl,
  });
}

class FakeFetch {
  calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  private impl: (url: string, init?: RequestInit) => Promise<Response>;

  constructor(impl?: (url: string, init?: RequestInit) => Promise<Response>) {
    this.impl = impl ?? (async () => new Response(null, { status: 200 }));
  }

  fetch = async (url: string, init?: RequestInit) => {
    this.calls.push({ url, init });
    return this.impl(url, init);
  };
}

describe("sanitizeLlmFeature", () => {
  it("keeps search_query_parse unchanged", () => {
    assert.equal(sanitizeLlmFeature("search_query_parse"), "search_query_parse");
  });

  it("normalizes Generic JSON to generic_json", () => {
    assert.equal(sanitizeLlmFeature("Generic JSON"), "generic_json");
  });

  it("returns unspecified for missing, empty, long, or newline-containing strings", () => {
    assert.equal(sanitizeLlmFeature(undefined), "unspecified");
    assert.equal(sanitizeLlmFeature(""), "unspecified");
    const longString = "a".repeat(200);
    assert.equal(sanitizeLlmFeature(longString), "unspecified");
    assert.equal(sanitizeLlmFeature("search\nquery"), "unspecified");
  });

  it("does not slice a long string into a slug", () => {
    const longString = "search_query_parse_" + "x".repeat(200);
    const result = sanitizeLlmFeature(longString);
    assert.equal(result, "unspecified");
    assert.ok(!result.includes("search_query_parse"));
  });
});

describe("sanitizeDistinctId", () => {
  it("returns anonymous for email addresses", () => {
    assert.equal(sanitizeDistinctId("user@example.com"), "anonymous");
  });

  it("returns anonymous when id contains whitespace", () => {
    assert.equal(sanitizeDistinctId("  workos_user_123  "), "anonymous");
  });

  it("returns trimmed uid when valid", () => {
    assert.equal(sanitizeDistinctId("workos_user_123"), "workos_user_123");
  });
});

describe("buildAiGenerationProperties", () => {
  const baseInput = {
    model: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    feature: "search_query_parse",
    traceId: "trace-abc-123",
    spanId: "span-def-456",
    distinctId: "user-uid-1",
    latencySeconds: 1.23456,
    isError: false,
    inputTokens: 100,
    outputTokens: 50,
    isFallback: true,
    attempt: 2,
  };

  it("includes model, provider, tokens, latency, feature, trace id, product, and llm_is_fallback", () => {
    const props = buildAiGenerationProperties(baseInput);
    assert.equal(props.$ai_model, "deepseek/deepseek-v4-flash");
    assert.equal(props.$ai_provider, "openrouter");
    assert.equal(props.$ai_input_tokens, 100);
    assert.equal(props.$ai_output_tokens, 50);
    assert.equal(props.$ai_latency, 1.235);
    assert.equal(props.llm_feature, "search_query_parse");
    assert.equal(props.$ai_span_name, "search_query_parse");
    assert.equal(props.$ai_trace_id, "trace-abc-123");
    assert.equal(props.product, "intervu");
    assert.equal(props.llm_is_fallback, true);
    assert.equal(props.llm_attempt, 2);
  });

  it("does not include prompt or response text keys", () => {
    const props = buildAiGenerationProperties(baseInput);
    const forbidden = [
      "$ai_input",
      "$ai_output_choices",
      "$ai_output",
      "prompt",
      "content",
      "messages",
    ];
    for (const key of forbidden) {
      assert.ok(!(key in props), `forbidden key present: ${key}`);
    }
  });

  it("omits token keys when tokens are missing", () => {
    const props = buildAiGenerationProperties({
      ...baseInput,
      inputTokens: undefined,
      outputTokens: undefined,
    });
    assert.ok(!("$ai_input_tokens" in props));
    assert.ok(!("$ai_output_tokens" in props));
  });

  it("omits cost when undefined and includes it when finite", () => {
    const withoutCost = buildAiGenerationProperties(baseInput);
    assert.ok(!("$ai_total_cost_usd" in withoutCost));

    const withCost = buildAiGenerationProperties({ ...baseInput, totalCostUsd: 0.0012 });
    assert.equal(withCost.$ai_total_cost_usd, 0.0012);
  });

  it("keeps RATE_LIMIT error code and drops free-text error codes", () => {
    const kept = buildAiGenerationProperties({
      ...baseInput,
      isError: true,
      errorCode: "RATE_LIMIT",
    });
    assert.equal(kept.$ai_error, "RATE_LIMIT");

    const dropped = buildAiGenerationProperties({
      ...baseInput,
      isError: true,
      errorCode: "the user's résumé text",
    });
    assert.ok(!("$ai_error" in dropped));
  });
});

describe("captureAiGeneration", () => {
  beforeEach(() => {
    setEnv({ key: "phc_test", host: "https://proxy.example.com/ph", siteUrl: "https://intervuhq.com" });
  });
  afterEach(() => {
    restoreEnv();
    global.fetch = ORIGINAL_FETCH;
  });

  it("posts $ai_generation with distinct_id, $host, $lib, and no planted prompt/response text", async () => {
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;

    captureAiGeneration({
      model: "deepseek/deepseek-v4-flash",
      provider: "openrouter",
      feature: "search_query_parse",
      traceId: "trace-1",
      spanId: "span-1",
      distinctId: "uid-abc",
      latencySeconds: 2.5,
      isError: false,
      inputTokens: 10,
      outputTokens: 5,
    });

    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].url, "https://proxy.example.com/ph/capture/");
    const body = JSON.parse(fake.calls[0].init?.body as string);
    assert.equal(body.api_key, "phc_test");
    assert.equal(body.event, "$ai_generation");
    assert.equal(body.properties.distinct_id, "uid-abc");
    assert.equal(body.properties.$host, "intervuhq.com");
    assert.equal(body.properties.$lib, "velai-server");
    assert.equal(body.properties.llm_feature, "search_query_parse");

    const bodyString = fake.calls[0].init?.body as string;
    assert.ok(!bodyString.includes(PLANTED_PROMPT));
    assert.ok(!bodyString.includes(PLANTED_RESPONSE));
  });

  it("never fetches when NEXT_PUBLIC_POSTHOG_KEY is unset", async () => {
    setEnv({ host: "https://proxy.example.com/ph", siteUrl: "https://intervuhq.com" });
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;

    captureAiGeneration({
      model: "m",
      provider: "openrouter",
      feature: "generic_json",
      traceId: "t",
      spanId: "s",
      distinctId: "u",
      latencySeconds: 1,
      isError: false,
    });

    assert.equal(fake.calls.length, 0);
  });

  it("does not throw when fetch rejects", async () => {
    const fake = new FakeFetch(async () => {
      throw new Error("network down");
    });
    global.fetch = fake.fetch as typeof fetch;

    assert.doesNotThrow(() => {
      captureAiGeneration({
        model: "m",
        provider: "openrouter",
        feature: "generic_json",
        traceId: "t",
        spanId: "s",
        distinctId: "u",
        latencySeconds: 1,
        isError: false,
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
