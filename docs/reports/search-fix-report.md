# Search-quality fix report (fix/search-quality, 2026-08-09)

## S1 — place-token hijack (DONE, live-verified)
`query-understanding.ts:128-172` `parsePlaceTokens` runs a company-corroboration guard (multi-word, free-text-only) before committing a place-strip: `companyCorroborationCandidates` (`:205`) builds "place+adjacent word" candidates, skipping function-word neighbors (stop-word collapse bug found live — see Concerns); `probeCompanyMatch` (`meilisearch.ts:873`) does a 1-hit `attributesToSearchOn:["company"]` probe; `rebuildAfterRejection` (`resolve-place.ts:409`) restores rejected spans to residual text. `LocationVocabulary.companyProbe` wired in `search.ts:71`.
Live gates (real UI, port 3000, `posted=any` to bypass the unrelated 30d default):
- "cleveland clinic" → top1 "Cleveland Clinic Florida - Neurology Outpatient | Cleveland Clinic" ✓ (was Iterativehealth pre-fix)
- "boston consulting" → Boston Consulting Group in top5 ✓
- "warehouse jobs in dallas" → residualQ="warehouse jobs in", Dallas+metro filter still applies, total=682 ✓
- "jobs in boston" → Boston+metro filter still applies ✓
- bare "cleveland" → unchanged, Cleveland+metro place filter, residualQ="" ✓
All 5 in `tests/e2e/search-quality-s1.spec.ts` pass.

## S2 — ISO3/synonym collision (DONE, live-verified)
`resolve-place.ts:58-64` `GUARD_WORDS` unions `Object.keys(JOBS_SYNONYMS)` (imported from `jobs/meilisearch.ts`, one source). Live: `applyQueryUnderstanding('swe')` → q="swe", no places; search returns SWE-relevant hits (SWE Intern @ chasi.ai, SWE Fellow @ Scaleai). `'sweden'` still resolves to a country place. Unit: `geo-resolve-place.test.ts:200-260` (swe/sre/deu/derivation, incl. fictitious "Sreland" ISO3 proving the fix is class-wide not swe-only).

## S3 — ranking rule order (CODE DONE; live PUT PENDING — see Concerns)
`meilisearch.ts:97` + `scripts/apply-ranking-rules.mjs:39` (source of truth + precedent script, kept in sync).
Before (live, confirmed 2026-08-09): `["words","typo","attributeRank","proximity","sort","wordPosition","exactness","posted_ts:desc"]`
After (submitted, task uid 433623): `["words","typo","proximity","attributeRank","wordPosition","exactness","sort","posted_ts:desc"]`
Gate (b) verified now (order-independent): browse + newest → strictly `posted_ts` descending ✓.
Gates (a)/(c) measured BEFORE only (task still enqueued): (a) q=stripe+newest → Dash0 "…(Stripe)" ranks #1 above real Stripe listings — confirms bug, needs re-check once live. (c) q="software engineer"+newest → already recent (Cfc/Jane Street), low risk.

## S4 — exposure trust badges (DONE)
`types.ts` PublicJob +4 optional fields. `job-detail-facts.ts:156` `deriveExposureBadges` (pure, positive-only). `JobDetail.tsx:400,637-655` renders in the ghost/trust cluster with `ContextHelp`. Renders `[]` for every doc today (fields absent) — dark launch confirmed.

## Tests
`npx tsx --test tests/unit/*.test.ts`: 1480 pass / 3 fail (viewer-cdp-evaluate, viewer-signal-client, viewer-webrtc-loopback — pre-existing werift fails, unrelated). New: 10 (S1) + 6 (S2) + 5 (S4) = 21 unit tests. `tsc --noEmit` clean. `npm run build` clean.
E2E (prod build via `node .next/standalone/server.js` — `next start` silently misserves under `output:"standalone"`, see Concerns): search-quality-s1.spec.ts 5/5 pass; jobs-first-screen.spec.ts 22/24 pass (2 known: history-length + scroll-restore, matches spec); grok-ux-wave.spec.ts 3/3 pass (1 conditional skip).

## Concerns
1. **S3 live PUT stuck**: task 433623 enqueued 25+ min, queue depth 132 and not draining (continuous live ingest). Will apply automatically, no action needed, but gates (a)/(c) need re-verification once it lands — did not cancel/reprioritize any queue tasks (would risk live ingest).
2. **`next start` incompatible with `output:"standalone"`** (this repo's config) — silently serves degraded/wrong behavior with no hard error, only a console warning. Cost significant debug time (first e2e pass showed the OLD pre-fix bug because of this, not a real regression). Worth a repo-level fix (standing `npm run dev`/CI script) outside this task's scope — flagging for visibility.
3. S1's company probe uses `attributesToSearchOn:["company"]` + `matchingStrategy:"all"`, which is looser than an exact-phrase match (e.g. "in dallas" alone matched "C001 Dallas College" before the function-word skip) — fixed via the FUNCTION_WORDS neighbor skip, but a future 3+-word company probe candidate isn't covered by this guard shape; scoped narrow (1 adjacent word) deliberately.
