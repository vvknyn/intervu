import { test } from "node:test";
import assert from "node:assert/strict";
import type { Queryable } from "../../src/lib/pg/pool";
import {
  RESUME_PARSE_DAILY_LIMIT,
  resolveParseRateLimit,
  getResumeParseCountToday,
  recordResumeParseAttempt,
} from "../../src/lib/resume/parse-rate-limit";

class FakeQueryable implements Queryable {
  calls: Array<{ text: string; params: unknown[] }> = [];
  private responses: Array<{ rows: unknown[] }>;

  constructor(responses: Array<{ rows: unknown[] }>) {
    this.responses = [...responses];
  }

  async query<R = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: R[] }> {
    this.calls.push({ text, params });
    const next = this.responses.shift();
    if (!next) throw new Error(`FakeQueryable: no scripted response for call #${this.calls.length}: ${text}`);
    return next as { rows: R[] };
  }
}

test("resolveParseRateLimit allows under the default daily limit", () => {
  assert.equal(resolveParseRateLimit(0), true);
  assert.equal(resolveParseRateLimit(RESUME_PARSE_DAILY_LIMIT - 1), true);
});

test("resolveParseRateLimit blocks at and beyond the default daily limit", () => {
  assert.equal(resolveParseRateLimit(RESUME_PARSE_DAILY_LIMIT), false);
  assert.equal(resolveParseRateLimit(RESUME_PARSE_DAILY_LIMIT + 5), false);
});

// Case other than the motivating (default-limit) scenario: an explicit,
// smaller limit must be honoured rather than the constant being hardcoded
// into the decision.
test("resolveParseRateLimit honours a caller-supplied limit, not just the default", () => {
  assert.equal(resolveParseRateLimit(0, 1), true);
  assert.equal(resolveParseRateLimit(1, 1), false);
  assert.equal(resolveParseRateLimit(2, 5), true);
});

test("getResumeParseCountToday returns 0 when no counter row exists yet", async () => {
  const fake = new FakeQueryable([{ rows: [] }]);
  const count = await getResumeParseCountToday(fake, "user-1");
  assert.equal(count, 0);
  assert.deepEqual(fake.calls[0].params, ["user-1"]);
  assert.match(fake.calls[0].text, /window_date = current_date/);
});

test("getResumeParseCountToday returns today's count when a row exists", async () => {
  const fake = new FakeQueryable([{ rows: [{ count: 7 }] }]);
  const count = await getResumeParseCountToday(fake, "user-1");
  assert.equal(count, 7);
});

test("recordResumeParseAttempt upserts and increments the existing count", async () => {
  const fake = new FakeQueryable([{ rows: [] }]);
  await recordResumeParseAttempt(fake, "user-1");
  assert.deepEqual(fake.calls[0].params, ["user-1"]);
  assert.match(fake.calls[0].text, /ON CONFLICT \(user_uid, window_date\)/);
  assert.match(fake.calls[0].text, /count = intervu\.resume_parse_counters\.count \+ 1/);
});
