import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { eventTypeLabel, fetchCompanyEvents, humanizeProjectorHeadline } from "@/lib/companies/events";
import type { CompanyChangeEvent } from "@/lib/companies/types";

function envelope(events: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { domain: "acme.com", events } }),
  } as unknown as Response;
}

function event(partial: Partial<CompanyChangeEvent> = {}): CompanyChangeEvent {
  return {
    event_type: "hiring_freeze",
    direction: "declining",
    headline: "hiring has stalled: 167 new roles in 14d, down from 485",
    occurred_at: "2026-08-16T09:00:00Z",
    confidence: 0.82,
    ...partial,
  };
}

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.SUBSPACE_API_KEY;
  process.env.SUBSPACE_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    mock.reset();
    process.env.SUBSPACE_API_KEY = prev;
  }
}

// ---------------------------------------------------------------------------
// eventTypeLabel — the ledger's vocabulary, rendered
// ---------------------------------------------------------------------------

test("eventTypeLabel turns the ledger's snake_case into a readable chip", () => {
  assert.equal(eventTypeLabel("hiring_freeze"), "Hiring freeze");
  assert.equal(eventTypeLabel("hiring_surge"), "Hiring surge");
  assert.equal(eventTypeLabel("funding"), "Funding");
});

// The load-bearing case, and the reason this is a derivation and not a
// `Record<EventType, string>`: the taxonomy is owned by the projector in the
// OTHER repo. A lookup map would render the next event type it learns to emit
// as an empty chip on a live page; this renders it correctly with no deploy
// here at all.
test("eventTypeLabel renders an event type this repo has never heard of", () => {
  assert.equal(eventTypeLabel("needs_outside_firm_emerged"), "Needs outside firm emerged");
  assert.equal(eventTypeLabel("some_future_signal_we_have_not_shipped"), "Some future signal we have not shipped");
});

test("eventTypeLabel yields an empty label rather than a stray chip on junk input", () => {
  // The component renders the chip only when the label is non-empty, so "" is
  // the contract for "draw nothing here", not a placeholder to print.
  assert.equal(eventTypeLabel(""), "");
  assert.equal(eventTypeLabel("   "), "");
  assert.equal(eventTypeLabel("_"), "");
});

// ---------------------------------------------------------------------------
// humanizeProjectorHeadline — the render seam every projector headline
// routes through, so a leaked enum token never reaches a page
// ---------------------------------------------------------------------------

test("humanizeProjectorHeadline turns a leaked enum token into readable words", () => {
  assert.equal(
    humanizeProjectorHeadline("posting velocity fell to multi_month_low"),
    "posting velocity fell to multi month low",
  );
});

test("humanizeProjectorHeadline collapses a run of underscores to one space", () => {
  assert.equal(humanizeProjectorHeadline("a__b"), "a b");
});

test("humanizeProjectorHeadline passes a normal sentence through unchanged", () => {
  assert.equal(
    humanizeProjectorHeadline("hiring has stalled: 167 new roles in 14d, down from 485"),
    "hiring has stalled: 167 new roles in 14d, down from 485",
  );
});

test("humanizeProjectorHeadline passes an empty string through unchanged", () => {
  assert.equal(humanizeProjectorHeadline(""), "");
});

// ---------------------------------------------------------------------------
// fetchCompanyEvents — fail-soft contract
// ---------------------------------------------------------------------------

test("fetchCompanyEvents returns the published events for a domain", async () => {
  await withKey(async () => {
    mock.method(globalThis, "fetch", async () => envelope([event(), event({ event_type: "funding", direction: "improving" })]));
    const events = await fetchCompanyEvents("acme.com");
    assert.equal(events.length, 2);
    assert.equal(events[0].event_type, "hiring_freeze");
  });
});

test("fetchCompanyEvents fails soft to [] with no API key configured", async () => {
  const prev = process.env.SUBSPACE_API_KEY;
  delete process.env.SUBSPACE_API_KEY;
  try {
    // No fetch stub at all: if the client called out here, the test would
    // attempt a real network request rather than return silently.
    assert.deepEqual(await fetchCompanyEvents("acme.com"), []);
  } finally {
    process.env.SUBSPACE_API_KEY = prev;
  }
});

test("fetchCompanyEvents fails soft to [] on a non-2xx response (e.g. the endpoint not deployed yet)", async () => {
  await withKey(async () => {
    mock.method(globalThis, "fetch", async () => ({ ok: false, status: 404 }) as Response);
    assert.deepEqual(await fetchCompanyEvents("acme.com"), []);
  });
});

test("fetchCompanyEvents fails soft to [] when the upstream call throws", async () => {
  await withKey(async () => {
    // Covers the timeout/abort path too — AbortSignal.timeout rejects the
    // same way a DNS failure does, and neither may break the page.
    mock.method(globalThis, "fetch", async () => {
      throw new Error("network down");
    });
    assert.deepEqual(await fetchCompanyEvents("acme.com"), []);
  });
});

test("fetchCompanyEvents fails soft to [] on a body that is not the expected envelope", async () => {
  await withKey(async () => {
    mock.method(globalThis, "fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { events: "not-an-array" } }),
    }) as unknown as Response);
    assert.deepEqual(await fetchCompanyEvents("acme.com"), []);
  });
});

// ---------------------------------------------------------------------------
// The seam guard: what we are willing to put on a page
// ---------------------------------------------------------------------------

test("fetchCompanyEvents drops a row with no statement in it", async () => {
  await withKey(async () => {
    mock.method(globalThis, "fetch", async () =>
      envelope([event({ headline: "   " }), event({ headline: "layoffs announced: 400 roles" })]),
    );
    const events = await fetchCompanyEvents("acme.com");
    assert.equal(events.length, 1);
    assert.equal(events[0].headline, "layoffs announced: 400 roles");
  });
});

// An undated "hiring has stalled" is the most misleading line the page could
// draw — it reads as a statement about now. A stamp that does not parse would
// otherwise reach toLocaleDateString and render "Invalid Date", which is why
// this is validated by parsing rather than by shape.
test("fetchCompanyEvents drops a row whose date cannot be read", async () => {
  await withKey(async () => {
    mock.method(globalThis, "fetch", async () =>
      envelope([
        event({ occurred_at: "not a date" }),
        event({ occurred_at: "" }),
        event({ occurred_at: undefined as unknown as string }),
        event({ occurred_at: "2026-08-16T09:00:00Z" }),
      ]),
    );
    const events = await fetchCompanyEvents("acme.com");
    assert.equal(events.length, 1);
    assert.equal(events[0].occurred_at, "2026-08-16T09:00:00Z");
  });
});

test("fetchCompanyEvents drops a row with no event type to label it", async () => {
  await withKey(async () => {
    mock.method(globalThis, "fetch", async () => envelope([event({ event_type: "" }), event()]));
    assert.equal((await fetchCompanyEvents("acme.com")).length, 1);
  });
});

test("fetchCompanyEvents survives a row that is not an object at all", async () => {
  await withKey(async () => {
    mock.method(globalThis, "fetch", async () =>
      envelope([null, "a string", 42, event()]),
    );
    const events = await fetchCompanyEvents("acme.com");
    assert.equal(events.length, 1);
  });
});

test("fetchCompanyEvents asks the API for a bounded number of events", async () => {
  await withKey(async () => {
    let requested = "";
    mock.method(globalThis, "fetch", async (url: string) => {
      requested = url;
      return envelope([]);
    });
    await fetchCompanyEvents("acme.com");
    // The page shows a short recent list, never the whole ledger for an
    // employer with years of history.
    assert.match(requested, /\/companies\/acme\.com\/events\?limit=\d+$/);
  });
});

// ---------------------------------------------------------------------------
// Evidence passthrough — the numbers must survive the client
// ---------------------------------------------------------------------------

test("fetchCompanyEvents carries the evidence through to the page", async () => {
  // The regression this guards: the claim reached the page and its proof did
  // not. harrods.com's stored title is bare ("hiring is accelerating"); every
  // number backing it arrives in `evidence`.
  await withKey(async () => {
    const evidence = {
      metrics: [
        { label: "Postings", value: "44 new roles in 14 days, vs 13 in the 14 before" },
        { label: "Pace", value: "3.4x the prior pace" },
      ],
      window: { start: "2026-05-14", end: "2026-06-11" },
      sourceUrl: null,
      provenance: "measured from postings we track",
    };
    mock.method(globalThis, "fetch", async () =>
      envelope([event({ event_type: "hiring_surge", headline: "hiring is accelerating", evidence })]),
    );
    const events = await fetchCompanyEvents("harrods.com");
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].evidence, evidence);
  });
});

test("fetchCompanyEvents still renders an event from an API build with no evidence field", async () => {
  // The field is optional on purpose: the two repos deploy separately, and a
  // company page must not go blank because the API is one release behind.
  await withKey(async () => {
    mock.method(globalThis, "fetch", async () => envelope([event()]));
    const events = await fetchCompanyEvents("acme.com");
    assert.equal(events.length, 1);
    assert.equal(events[0].evidence, undefined);
  });
});
