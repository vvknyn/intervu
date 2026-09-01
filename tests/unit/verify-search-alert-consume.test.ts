import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import { consumeAndSaveSearchAlert, CONTACT_COOKIE_NAME } from "../../src/lib/identity/contact-cookie";
import { GET } from "../../src/app/api/search-alerts/verify/route";

class FakeQueryable implements Queryable {
  calls: Array<{ text: string; params: unknown[] }> = [];
  private responses: Array<{ rows: unknown[] }>;

  constructor(responses: Array<{ rows: unknown[] }> = []) {
    this.responses = [...responses];
  }

  async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
    this.calls.push({ text, params });
    const next = this.responses.shift();
    if (!next) throw new Error(`FakeQueryable: no scripted response for call #${this.calls.length}: ${text}`);
    return next as { rows: R[] };
  }
}

describe("consumeAndSaveSearchAlert — invalid token", () => {
  it("returns null and never touches email_saved_searches", async () => {
    const q = new FakeQueryable([{ rows: [] }]);
    const result = await consumeAndSaveSearchAlert(q, "a".repeat(64));
    assert.equal(result, null);
    assert.equal(q.calls.length, 1);
  });
});

describe("consumeAndSaveSearchAlert — success", () => {
  it("consumes token and upserts saved search", async () => {
    const q = new FakeQueryable([
      {
        rows: [
          {
            identity_id: "id-1",
            redirect_path: "/jobs?q=pm",
            intent_name: "PM roles",
            intent_href: "/jobs?q=pm",
            intent_search_hash: "hash1",
          },
        ],
      },
      {
        rows: [
          {
            id: "id-1",
            email: "a@b.co",
            email_verified_at: "2026-08-19T00:00:00Z",
            contact_token: "tok-1",
          },
        ],
      },
      { rows: [] },
    ]);
    const result = await consumeAndSaveSearchAlert(q, "a".repeat(64));
    assert.deepEqual(result, { redirectPath: "/jobs?q=pm", contactToken: "tok-1" });
    assert.equal(q.calls.length, 3);
    assert.match(q.calls[2].text, /INSERT INTO intervu\.email_saved_searches/);
    assert.deepEqual(q.calls[2].params, ["id-1", "hash1", "PM roles", "/jobs?q=pm"]);
  });
});

describe("GET /api/search-alerts/verify — failure paths", () => {
  it("redirects to failure path when no token", async () => {
    const res = await GET(new Request("http://x/api/search-alerts/verify"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "/jobs?search_alert=0");
  });

  it("redirects to failure path when PG is unset", async () => {
    const res = await GET(new Request("http://x/api/search-alerts/verify?token=abc"));
    assert.equal(res.status, 307);
    assert.equal(res.headers.get("location"), "/jobs?search_alert=0");
  });
});

describe("CONTACT_COOKIE_NAME", () => {
  it("is stable", () => {
    assert.equal(typeof CONTACT_COOKIE_NAME, "string");
    assert.ok(CONTACT_COOKIE_NAME.length > 0);
  });
});
