import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_ANSWER_ENGINE_BOTS,
  buildRobotsRules,
  DEEP_SEARCH_DISALLOW_PATTERN,
  PRIVATE_PATHS,
  SEARCH_ENGINE_BOTS,
} from "../../src/lib/shield/robots-policy";

function ruleFor(rules: ReturnType<typeof buildRobotsRules>, agent: string) {
  return rules.find((r) => (Array.isArray(r.userAgent) ? r.userAgent.includes(agent) : r.userAgent === agent));
}

test("buildRobotsRules: the general '*' rule allows the marketing surface and disallows /api/ + private paths", () => {
  const rules = buildRobotsRules();
  const general = ruleFor(rules, "*");
  assert.ok(general);
  assert.equal(general!.allow, "/");
  for (const path of PRIVATE_PATHS) {
    assert.ok(Array.isArray(general!.disallow) && general!.disallow.includes(path), `expected ${path} disallowed`);
  }
});

test("buildRobotsRules: every named search engine is explicitly allowed on the marketing surface", () => {
  const rules = buildRobotsRules();
  for (const bot of SEARCH_ENGINE_BOTS) {
    const rule = ruleFor(rules, bot);
    assert.ok(rule, `expected a rule covering ${bot}`);
    assert.equal(rule!.allow, "/");
  }
});

test("buildRobotsRules: AI answer-engine/GEO crawlers get the SAME allow treatment as search engines — no blanket block", () => {
  const rules = buildRobotsRules();
  for (const bot of AI_ANSWER_ENGINE_BOTS) {
    const rule = ruleFor(rules, bot);
    assert.ok(rule, `expected a rule covering ${bot}`);
    assert.equal(rule!.allow, "/");
    // Never fully disallowed ("/") the way a blanket block would.
    const disallow = Array.isArray(rule!.disallow) ? rule!.disallow : [rule!.disallow].filter(Boolean);
    assert.equal(disallow.includes("/"), false);
  }
});

test("buildRobotsRules: search engines and AI crawlers share the exact same rule body", () => {
  const rules = buildRobotsRules();
  const googleRule = ruleFor(rules, "Googlebot");
  const gptRule = ruleFor(rules, "GPTBot");
  assert.deepEqual(googleRule!.allow, gptRule!.allow);
  assert.deepEqual(googleRule!.disallow, gptRule!.disallow);
});

test("buildRobotsRules: named bots disallow every PRIVATE_PATHS entry, not just /api/", () => {
  const rules = buildRobotsRules();
  const googleRule = ruleFor(rules, "Googlebot");
  assert.ok(googleRule);
  const disallow = Array.isArray(googleRule!.disallow) ? googleRule!.disallow : [googleRule!.disallow].filter(Boolean);
  for (const path of PRIVATE_PATHS) {
    assert.ok(disallow.includes(path), `expected Googlebot to disallow ${path}`);
  }
});

test("buildRobotsRules: /api/ is disallowed for every rule, named or general", () => {
  const rules = buildRobotsRules();
  for (const rule of rules) {
    const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow].filter(Boolean);
    assert.ok(disallow.includes("/api/"), `expected /api/ disallowed for ${JSON.stringify(rule.userAgent)}`);
  }
});

test("buildRobotsRules: query-parameterized search results ('/?...') are disallowed for every rule", () => {
  const rules = buildRobotsRules();
  for (const rule of rules) {
    const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow].filter(Boolean);
    assert.ok(disallow.includes(DEEP_SEARCH_DISALLOW_PATTERN));
  }
});

test("buildRobotsRules: a crawler named in neither list only ever matches the general '*' rule", () => {
  const rules = buildRobotsRules();
  const named = rules.filter((r) => Array.isArray(r.userAgent));
  const allNamed = named.flatMap((r) => r.userAgent as string[]);
  assert.equal(allNamed.includes("SomeRandomBot/1.0"), false);
});

test("buildRobotsRules: search-engine and AI-crawler name lists never overlap", () => {
  const overlap = SEARCH_ENGINE_BOTS.filter((bot) => (AI_ANSWER_ENGINE_BOTS as readonly string[]).includes(bot));
  assert.deepEqual(overlap, []);
});

test("buildRobotsRules: exactly two rules — general and the shared crawlable-bots rule", () => {
  assert.equal(buildRobotsRules().length, 2);
});
