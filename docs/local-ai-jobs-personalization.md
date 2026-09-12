# Local AI + login personalization on `/jobs`

How to run the R&D worktree and what auto-Rank should look like after Velai login personalization.

## Worktree setup (founder)

From the main repo checkout:

```bash
cd ~/Antigravity/Code/intervu/intervu-main-rd
npm install
PORT=3002 npm run dev
```

No extra env vars are required for local résumé parse (`?localAi=1`) — parsing stays on-device.

## Try it

1. Open [http://localhost:3002/jobs?localAi=1](http://localhost:3002/jobs?localAi=1)
2. Upload or use a stored local résumé (browser storage, not server).
3. **Expected:** the board lands on **Ranked** results (`sort=fit` in the URL) with:
   - OR title phrases from the résumé (`buildMatchQuery`)
   - Meili **rails** from `agent_preferences` when signed in (location country, work mode, salary floor, seniority, etc.)
   - Filter panel collapsed; toolbar entry labeled **Narrow** instead of “All filters”

Signed-in users with saved prefs get the same behavior on a cold `/jobs` visit without `localAi=1`, as long as they have a usable résumé on file and/or configured search prefs.

## Before / after

| | Before (cold `/jobs`) | After (personalized login) |
|---|---|---|
| Sort | Newest / relevance browse | Ranked (`sort=fit`) when résumé + prefs signal |
| Filters | User opens filters and Rank manually | Prefs applied as Meili rails automatically |
| Chrome | “All filters” expanded by habit | **Narrow** — filters collapsed, escape hatch |

## Implementation map

- Prefs → URL: `searchPreferencesToJobsUrlState`, `mergePrefsWithRankPhrases` in `src/lib/jobs/prefs-to-url-state.ts`
- Rank merge: `personalizedFitFromResume` in `src/lib/jobs/apply-personalized-fit.ts`
- Auto-apply gate: `isAutoPersonalizeUrl` — pristine `/jobs` or `?sort=fit` only; deliberate `?q=` / facet URLs are not clobbered
