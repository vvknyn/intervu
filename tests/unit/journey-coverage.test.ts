import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateJourneyCoverage, failureText, isGatedCommand, routeOf } from "../../scripts/lib/journey-coverage.mjs";
import { parseCatalog } from "../../scripts/lib/journey-catalog.mjs";

const verdict = (changedPaths: string[], commitMessages: string[] = ["fix: x"]) =>
  evaluateJourneyCoverage({ changedPaths, commitMessages });
const TRAILER = "fix: x\n\nJourney-Impact: none — pure refactor, no behaviour change";

test("src/components change with no journey change fails (whole class, not just src/app)", () => {
  assert.equal(verdict(["src/components/jobs/JobCard.tsx"]).ok, false);
  assert.equal(verdict(["src/actions/account.ts"]).ok, false);
  assert.equal(verdict(["src/app/jobs/page.tsx"]).ok, false);
});

test("a changed journey spec passes", () => {
  assert.equal(verdict(["src/app/jobs/page.tsx", "tests/e2e/journeys/jobs.spec.ts"]).ok, true);
});

test("only CATALOG.md or fixtures changed does not pass — a row alone is not a guard", () => {
  assert.equal(verdict(["src/app/jobs/page.tsx", "tests/journeys/CATALOG.md"]).ok, false);
  assert.equal(verdict(["src/app/jobs/page.tsx", "tests/e2e/journeys/fixtures.ts"]).ok, false);
});

test("a valid Journey-Impact trailer passes; a short or empty reason fails", () => {
  const paths = ["src/components/x/Y.tsx"];
  assert.equal(verdict(paths, [TRAILER]).ok, true);
  assert.equal(verdict(paths, ["fix\n\nJourney-Impact: none — refactor"]).ok, false);
  assert.equal(verdict(paths, ["fix\n\nJourney-Impact: none —"]).ok, false);
  assert.equal(verdict(paths, ["fix\n\nJourney-Impact: none"]).ok, false);
});

test("docs/scripts-only and test files under src/app pass", () => {
  assert.equal(verdict(["docs/a.md", "scripts/x.mjs", "src/lib/y.ts"]).ok, true);
  assert.equal(verdict(["src/app/jobs/page.test.tsx", "src/components/a/__tests__/b.ts"]).ok, true);
});

test("routeOf strips route groups and file name; failureText points at matching catalog rows", () => {
  assert.equal(routeOf("src/app/(site)/jobs/[slug]/page.tsx"), "/jobs/[slug]");
  assert.equal(routeOf("src/components/a.tsx"), null);
  const rows = parseCatalog("| J-JOBS-03 | opens job | p | /jobs/<slug> | signed-out | no | covered | jobs.spec.ts |\n| J-CO-01 | company | p | /co/<slug> | signed-out | no | uncovered | — |");
  const text = failureText(verdict(["src/app/jobs/[slug]/page.tsx"]), rows);
  assert.match(text, /J-JOBS-03/);
  assert.doesNotMatch(text, /J-CO-01/);
  assert.match(text, /Journey-Impact: none/);
});

test("hook gates git push / gh pr create by tokens, not substrings", () => {
  for (const c of ["git push", "git push -u origin feat/x", "git -C /repo push", "FOO=1 git push", "npm test && git push", "gh pr create --title x"]) {
    assert.equal(isGatedCommand(c), true, c);
  }
  for (const c of ["git status", "git commit -m 'then git push later'", "echo git push", "git commit -m \"gh pr create\"", "git log --grep push", "gh pr view 3", "cat <<'EOF'\ngit push\nEOF"]) {
    assert.equal(isGatedCommand(c), false, c);
  }
});
