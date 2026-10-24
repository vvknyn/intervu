import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { captureServerEvent, postServerCapture } from "../../src/lib/analytics/server-capture";

const ORIGINAL_ENV = {
  key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
};
const ORIGINAL_FETCH = global.fetch;

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

describe("captureServerEvent", () => {
  beforeEach(() => {
    setEnv({ key: "phc_test", host: "https://proxy.example.com/ph", siteUrl: "https://intervuhq.com" });
  });
  afterEach(() => {
    restoreEnv();
    global.fetch = ORIGINAL_FETCH;
  });

  it("posts search_alert_submitted to PostHog's capture endpoint with a random distinct_id inside properties", async () => {
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;

    captureServerEvent("search_alert_submitted", {
      surface: "results",
      query_length: 10,
      filter_count: 1,
      has_results: true,
      outcome: "accepted",
    });

    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].url, "https://proxy.example.com/ph/capture/");
    const body = JSON.parse(fake.calls[0].init?.body as string);
    assert.equal(body.api_key, "phc_test");
    assert.equal(body.event, "search_alert_submitted");
    assert.match(body.properties.distinct_id, /^[0-9a-f-]{36}$/);
    assert.equal(body.properties.$process_person_profile, false);
    assert.equal(body.properties.surface, "results");
    assert.equal(body.properties.outcome, "accepted");
    assert.equal(body.properties.$host, "intervuhq.com");
    assert.equal(body.properties.$lib, "velai-server");
    assert.ok(typeof body.timestamp === "string");
  });

  it("posts search_alert_verified without a person profile", async () => {
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;

    captureServerEvent("search_alert_verified", {
      surface: "zero_results",
      query_length: 3,
      filter_count: 0,
      has_results: false,
    });

    assert.equal(fake.calls.length, 1);
    const body = JSON.parse(fake.calls[0].init?.body as string);
    assert.equal(body.event, "search_alert_verified");
    assert.equal(body.properties.$process_person_profile, false);
    assert.equal(body.properties.has_results, false);
    assert.equal(body.properties.$host, "intervuhq.com");
    assert.equal(body.properties.$lib, "velai-server");
  });

  it("derives $host as the bare hostname even when the site URL carries a port and a path", async () => {
    setEnv({ key: "phc_test", host: "https://proxy.example.com/ph", siteUrl: "https://staging.intervuhq.com:8443/app" });
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;

    captureServerEvent("search_alert_submitted", {
      surface: "results",
      query_length: 5,
      filter_count: 2,
      has_results: true,
      outcome: "accepted",
    });

    assert.equal(fake.calls.length, 1);
    const body = JSON.parse(fake.calls[0].init?.body as string);
    assert.equal(body.properties.$host, "staging.intervuhq.com");
    assert.equal(body.properties.$lib, "velai-server");
  });

  it("does not let caller-supplied properties overwrite $host or $lib", async () => {
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;

    captureServerEvent("search_alert_submitted", {
      surface: "results",
      query_length: 1,
      filter_count: 0,
      has_results: true,
      outcome: "accepted",
      // @ts-expect-error — EventPayloads doesn't declare these keys; the
      // point is to prove a same-named property can't smuggle a spoofed
      // value through if one ever did.
      $host: "evil.example.com",
      $lib: "spoofed",
    });

    assert.equal(fake.calls.length, 1);
    const body = JSON.parse(fake.calls[0].init?.body as string);
    assert.equal(body.properties.$host, "intervuhq.com");
    assert.equal(body.properties.$lib, "velai-server");
  });

  it("never lets a caller choose the distinct_id: every event gets its own random one", async () => {
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;
    const payload = { surface: "results", query_length: 1, filter_count: 0, has_results: true, outcome: "accepted" } as const;

    // Two different callers each try to hand over an account id; neither survives.
    captureServerEvent("search_alert_submitted", { ...payload, distinct_id: "workos_user_A" } as never);
    postServerCapture("mcp_tool_call", { distinct_id: "workos_user_B", uid: "workos_user_B" });

    const [first, second] = fake.calls.map((c) => JSON.parse(c.init?.body as string).properties);
    for (const props of [first, second]) {
      assert.match(props.distinct_id, /^[0-9a-f-]{36}$/);
      assert.equal(props.$process_person_profile, false);
    }
    assert.notEqual(first.distinct_id, second.distinct_id);
    assert.equal(captureServerEvent.length, 2, "the chokepoint takes an event and its properties, never an id");
    assert.equal(postServerCapture.length, 2);
  });

  it("never fetches when NEXT_PUBLIC_POSTHOG_KEY is unset", async () => {
    setEnv({ host: "https://proxy.example.com/ph", siteUrl: "https://intervuhq.com" });
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;

    captureServerEvent("search_alert_submitted", {
      surface: "results",
      query_length: 1,
      filter_count: 0,
      has_results: true,
      outcome: "accepted",
    });

    assert.equal(fake.calls.length, 0);
  });

  it("never throws, and issues no fetch, when NEXT_PUBLIC_SITE_URL is unset and no host override is given", async () => {
    setEnv({ key: "phc_test" });
    const fake = new FakeFetch();
    global.fetch = fake.fetch as typeof fetch;

    assert.doesNotThrow(() => {
      captureServerEvent("search_alert_verified", {
        surface: "results",
        query_length: 1,
        filter_count: 0,
        has_results: true,
      });
    });
    assert.equal(fake.calls.length, 0);
  });

  it("swallows a rejected fetch instead of throwing", async () => {
    const fake = new FakeFetch(async () => {
      throw new Error("network down");
    });
    global.fetch = fake.fetch as typeof fetch;

    assert.doesNotThrow(() => {
      captureServerEvent("search_alert_submitted", {
        surface: "results",
        query_length: 1,
        filter_count: 0,
        has_results: true,
        outcome: "accepted",
      });
    });
    // Let the fire-and-forget promise settle before the test process exits.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
