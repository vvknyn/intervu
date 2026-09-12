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

## Prefs onboarding (one-shot dialog)

On a first visit, signed-in users with unconfigured job-search prefs (or guests on `?localAi=1` with a usable on-device résumé) see a **one-shot Dialog** — not a sticky strip — prefilled from the résumé (location, work mode, seniority, min salary). **Save & rank** writes prefs and applies Rank/rails; **Skip** (or closing the dialog) marks onboarding complete and never shows it again on `/jobs` for that browser/account. Later edits belong in **Settings → Job search** (`/settings?tab=prefs`).

## Before / after

| | Before (cold `/jobs`) | After (personalized login) |
|---|---|---|
| Sort | Newest / relevance browse | Ranked (`sort=fit`) when résumé + prefs signal |
| Filters | User opens filters and Rank manually | Prefs applied as Meili rails automatically |
| Chrome | “All filters” expanded by habit | **Narrow** — filters collapsed, escape hatch |

## Silent packet (high-fit job detail)

On job detail, when local AI is on and fit **≥ 75**, a tailored résumé draft pre-warms on-device (~1.2s debounce). The Customize button becomes **Review packet** when ready or warming; low-fit jobs keep **Customize** and never start background tailor. Drafts live in `localStorage` only — see [silent-packet.md](./silent-packet.md). On mobile (~390px), the document action bar uses the compact **Packet** label; prefs onboarding uses a full-width bottom sheet — details in [silent-packet.md § Mobile](./silent-packet.md#mobile-390px).

## Implementation map

- Prefs → URL: `searchPreferencesToJobsUrlState`, `mergePrefsWithRankPhrases` in `src/lib/jobs/prefs-to-url-state.ts`
- Rank merge: `personalizedFitFromResume` in `src/lib/jobs/apply-personalized-fit.ts`
- Auto-apply gate: `isAutoPersonalizeUrl` — pristine `/jobs` or `?sort=fit` only; deliberate `?q=` / facet URLs are not clobbered
- Silent packet: `shouldPrewarmSilentPacket`, `useSilentPacket` in `src/lib/local-ai/`
