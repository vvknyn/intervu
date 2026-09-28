# User-journey catalog

The single list of user journeys velai must keep working. Each row is one journey; a covered row is guarded by a tagged Playwright spec in `tests/e2e/journeys/`.

## Run

```
npm run test:journeys:prod    # against https://velai.app — run after every deploy and before calling a user-facing fix done
npm run test:journeys         # against PLAYWRIGHT_BASE_URL, or a local dev server on :3000
```

Both print `journeys: N total, C covered, U uncovered, K known-bug`, then pass/fail per journey on a desktop (1440x900) and a mobile (390x844) project. Reports land in the gitignored `journeys-report/`.

## Contract

- **ID**: `J-<AREA>-NN` (e.g. `J-JOBS-03`), unique. One table per area, below.
- **Tag**: the spec test carries `{ tag: ['@J-JOBS-03'] }`. A `@writes` tag is added when the journey writes to prod data.
- **Read-only by default**: `@writes` tests are skipped unless `JOURNEYS_ALLOW_WRITES=1`. A row with `Writes = yes` must have its test tagged `@writes`.
- **Status**: `covered` (tagged spec exists and passes), `uncovered` (listed, no spec yet; Spec = `—`), `known-bug` (spec exists, wrapped in `test.fail()` with a reason naming the bug, so the suite stays green while the guard exists).
- **Fixtures**: import `test`/`expect` from `tests/e2e/journeys/fixtures.ts`. Analytics and `/api/telemetry` requests are aborted; console errors, page errors and same-origin 5xx responses are collected as `diagnostics` for a spec to assert.
- **Lint**: `npx vitest run tests/unit/journey-catalog.test.ts` fails on a tag with no row, a duplicate ID, a covered/known-bug row with no tagged spec, an uncovered row that has one, or a Writes=yes row whose test lacks `@writes`.

## Add a journey

1. Add a row to the area table (new area = new table). Start it `uncovered` if you are not writing the spec now.
2. Add the test to `tests/e2e/journeys/<area>.spec.ts` with the `@J-…` tag, then set the row to `covered` and fill Spec.
3. Run `npm run test:journeys:prod`.

## Coverage gate

A push or PR whose range changes a user-facing file (non-test files under `src/app/`, `src/components/`, `src/actions/`) is blocked unless the same range also changes a spec under `tests/e2e/journeys/`. A catalog row alone does not pass. For a change that cannot alter any journey (pure refactor, styling), add a commit trailer instead:

```
Journey-Impact: none — <reason, at least 15 characters>
```

Enforced by `scripts/check-journey-coverage.mjs` at three points: the Claude Code PreToolUse hook (`git push` / `gh pr create`), the git `pre-push` hook (`.githooks/`, enabled by `npm install`), and `npm run preflight`.

## JOBS

| ID | Journey | Persona | Entry | Auth | Writes | Status | Spec |
|----|---------|---------|-------|------|--------|--------|------|
| J-JOBS-01 | Opens /jobs cold and sees the landing with one visible h1 and a primary CTA | First-time visitor | /jobs | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-02 | Searches a keyword from the search box and gets job rows, `q=` in the URL | Returning visitor | /jobs | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-03 | Opens a job page directly: one visible h1 and one visible Apply button | Job seeker | /jobs/<slug> | signed-out | no | covered | jobs.spec.ts |
| J-JOBS-04 | Searches as a returning visitor with no uncaught page errors (React hydration error #418 seen on prod 2026-09-28) | Returning visitor | /jobs | signed-out | no | known-bug | jobs.spec.ts |
