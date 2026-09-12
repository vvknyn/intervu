# Silent packet (on-device résumé pre-warm)

When a user opens a **high-fit** job on job detail, Velai pre-warms a tailored résumé draft in the background. The Customize affordance becomes **Review packet** once a packet is ready or still warming.

## Trigger

All of the following must be true:

1. Job detail is visible (client mount).
2. Local AI is enabled (`?localAi=1` or Settings toggle → `velai.localAi.enabled`).
3. The on-device résumé is usable for Rank (`resumeIsUsable`).
4. Fit score is **≥ 75** — same threshold as the brand match chip (`SILENT_PACKET_FIT_THRESHOLD` / `MATCH_CHIP_BRAND_THRESHOLD`).

`sort=fit` does **not** bypass a low score. A job can appear in a fit-ranked list and still skip pre-warm when its computed fit is below 75, so weak hits never burn the on-device model.

Pre-warm debounces **~1.2s** after the job becomes visible. Navigating away, changing job id, or unmounting cancels the debounce; in-flight runs ignore their result on cancel.

## Consent and engine

- **With consent** (`velai.localAi.consent`): runs the on-device model when available.
- **Without consent**: silently caches a **rules-only** draft (`allowModel: false`) so Review packet can still open instantly — no model download.
- Failed or empty drafts stay invisible (no error toast, CTA stays **Customize**).

## Cache

- **Key:** `silentPacketCacheKey(jobId, resumeFingerprint)` → `{jobId}:{fingerprint}` in a single localStorage blob (`velai.localAi.silentPacket`).
- **Fingerprint:** stable hash of profile + experience bullets + summary (pure function in `src/lib/local-ai/silent-packet.ts`).
- **Retention:** last **10** entries (LRU prune).
- **Privacy:** draft text never leaves the device; no server upload; no new settings surface.

Multiple `LocalCustomizePanel` mounts (JobDetail action row, action bar, document) share one module-level in-flight map so the model never runs twice for the same job + résumé.

## Try it

1. `PORT=3002 npm run dev` (or your worktree port).
2. Open `/jobs?localAi=1`, upload or restore a usable on-device résumé.
3. Open a job detail where the match chip shows **≥ 75** (brand outline).
4. Wait ~1–2s — the button should read **Review packet** (brand-outline, not inverted Apply).
5. Click **Review packet** — the dialog opens with the draft immediately (no reset/regenerate when cached).
6. Open a low-fit job (< 75) — CTA stays **Customize**; no background tailor.

## Code map

| Piece | Path |
|---|---|
| Gate, fingerprint, debounce scheduler | `src/lib/local-ai/silent-packet.ts` |
| localStorage cache | `src/lib/local-ai/silent-packet-cache.ts` |
| React hook + panel CTA | `src/lib/local-ai/use-silent-packet.ts`, `src/components/jobs/LocalCustomizePanel.tsx` |
| Unit tests | `tests/unit/silent-packet.test.ts`, `tests/unit/silent-packet-cache.test.ts` |
