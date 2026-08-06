import { test } from "node:test";
import assert from "node:assert/strict";
import { shortDate } from "../../src/lib/jobs/presentation";

// Live bug (2026-08-05): shortDate rendered in the machine's LOCAL timezone.
// posted_at is a date-stamp (always midnight UTC), not a local wall-clock
// moment, so a viewer west of UTC read 2026-07-08T00:00:00Z as "Jul 7" — a
// day earlier than the date the source actually claims.
test("shortDate: midnight-UTC date-stamp reads as the SAME calendar day regardless of local offset", () => {
    assert.equal(shortDate(Date.parse("2026-07-08T00:00:00Z")), "Jul 8");
});

test("shortDate: a different midnight-UTC date-stamp near a month boundary", () => {
    assert.equal(shortDate(Date.parse("2026-01-01T00:00:00Z")), "Jan 1");
});

test("shortDate: a mid-day UTC timestamp still reads the UTC calendar day, not a shifted one", () => {
    assert.equal(shortDate(Date.parse("2026-12-31T23:00:00Z")), "Dec 31");
});
