import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LANDING_LANE,
  LANDING_LANES,
  nextPathForLandingLane,
  parseConnectClientParam,
  signInCtaLabel,
  signedInCtaLabel,
} from "../../src/lib/auth/landing-intent";

test("nextPathForLandingLane preserves browse vs connect intents", () => {
  assert.equal(nextPathForLandingLane("board"), "/jobs");
  assert.equal(nextPathForLandingLane("mcp"), "/connect?client=claude");
  assert.equal(nextPathForLandingLane("claw"), "/connect?client=openclaw");
});

test("sign-in CTA labels follow the active lane", () => {
  assert.equal(signInCtaLabel("board"), "Browse jobs");
  assert.match(signInCtaLabel("mcp"), /claude/i);
  assert.match(signInCtaLabel("claw"), /openclaw/i);
  assert.equal(signedInCtaLabel("board"), "Browse jobs");
  assert.equal(signedInCtaLabel("mcp"), "Open Connect");
});

test("parseConnectClientParam accepts known clients only", () => {
  assert.equal(parseConnectClientParam("claude"), "claude");
  assert.equal(parseConnectClientParam("OpenClaw"), "openclaw");
  assert.equal(parseConnectClientParam("nope"), null);
  assert.equal(parseConnectClientParam(null), null);
});

test("landing boots on the job board, with all three lanes present once", () => {
  assert.equal(DEFAULT_LANDING_LANE, "board");
  assert.equal(LANDING_LANES[0].id, "board");
  assert.deepEqual(
    [...LANDING_LANES].map((l) => l.id).sort(),
    ["board", "claw", "mcp"],
  );
});
