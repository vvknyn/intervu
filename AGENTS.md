<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Regression journeys

- `tests/journeys/CATALOG.md` is the list of user journeys; each covered row has a tagged spec in `tests/e2e/journeys/`.
- Run `npm run test:journeys:prod` after every deploy and before claiming any user-facing fix done.
- Add a catalog row + a spec tagged `@J-AREA-NN` for every new journey and every fixed bug.
- Coverage gate: a push or PR that changes non-test files under `src/app/`, `src/components/` or `src/actions/` is blocked (Claude hook, git pre-push, `npm run preflight`) unless the range also changes a spec under `tests/e2e/journeys/`. A catalog row alone does not count. For a change that cannot alter a journey, add a commit trailer: `Journey-Impact: none — <reason, 15+ chars>`.
