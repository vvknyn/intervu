import { expect, test } from "./fixtures";

/**
 * The two velai.app calls the Velai Chrome extension makes to put a job in the
 * tracker ("Save" and "I applied", POST /api/extension/track). The extension's
 * own behaviour is checked in Chromium by `node extension/scripts/check-panel.mjs`;
 * these hold the server's side that the extension relies on, with no account.
 */

const JOB = { title: "Registered Nurse - ICU", company: "Cedarbrook Health", applyUrl: "https://careers.cedarbrook.example/jobs/rn-icu" };

for (const stage of ["saved", "applied"] as const) {
  test(`The extension's ${stage === "saved" ? "Save" : "I applied"} without a velai.app sign-in is refused and adds nothing`, { tag: [stage === "saved" ? "@J-TRACKER-75" : "@J-TRACKER-76"] }, async ({ request }) => {
    const res = await request.post("/api/extension/track", {
      headers: { "content-type": "application/json" },
      data: { ...JOB, stage },
    });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "Signed out" });
  });
}

test("The extension's tracker call only takes JSON, so no other site's form can add to someone's tracker", { tag: ["@J-TRACKER-77"] }, async ({ request }) => {
  const res = await request.post("/api/extension/track", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: `title=${encodeURIComponent(JOB.title)}&company=${encodeURIComponent(JOB.company)}&stage=saved`,
  });
  expect(res.status()).toBe(415);
  expect(await res.json()).toEqual({ ok: false, error: "Expected JSON" });
});
