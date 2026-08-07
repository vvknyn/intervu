import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextPathForLandingLane,
  parseConnectClientParam,
  signInCtaLabel,
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
});

test("parseConnectClientParam accepts known clients only", () => {
  assert.equal(parseConnectClientParam("claude"), "claude");
  assert.equal(parseConnectClientParam("OpenClaw"), "openclaw");
  assert.equal(parseConnectClientParam("nope"), null);
  assert.equal(parseConnectClientParam(null), null);
});
