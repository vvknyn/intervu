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

## Mobile (~390px)

Same Next.js app at phone width (iPhone 13 viewport in `tests/e2e/mobile.spec.ts` — resize the browser or run that spec).

- **Document action bar** (`JobDetailDocument` → `JobDetailActionBar`, `lg:hidden`): Apply reads **Apply** (full label in `aria-label`); Customize / packet uses the **compact** trigger. When a silent packet is ready or warming, the visible label is **Packet** (`aria-label` stays **Review packet**).
- **SERP sheet action row** (`JobDetail`): full **Review packet** / **Customize for this job** labels — not compact.
- **Packet dialog**: below `sm`, full-width bottom sheet (`max-h-[95dvh]`), scrollable draft body, sticky footer — Copy, **Download PDF**, and Accept stay reachable (PDF is never `hidden sm:`).
- **Prefs onboarding** (`PrefsOnboardingDialog`): same bottom-sheet treatment; inputs are full width on small screens.

Pre-warm runs on every viewport where `LocalCustomizePanel` mounts — no `lg:` / hover gate.

### Verify mobile

1. Dev server on `/jobs?localAi=1`, open a high-fit job at ~390px width.
2. Document page (`/jobs/[slug]`): sticky bar shows **Apply** + **Packet** (after ~1–2s) + bookmark.
3. Open **Packet** — dialog fills the bottom of the screen; scroll the draft; tap **Download PDF**.
4. Cold visit `/jobs` — prefs onboarding sheet pins to the bottom with full-width location input.

## Code map

| Piece | Path |
|---|---|
| Gate, fingerprint, debounce scheduler | `src/lib/local-ai/silent-packet.ts` |
| localStorage cache | `src/lib/local-ai/silent-packet-cache.ts` |
| React hook + panel CTA | `src/lib/local-ai/use-silent-packet.ts`, `src/components/jobs/LocalCustomizePanel.tsx` |
| Unit tests | `tests/unit/silent-packet.test.ts`, `tests/unit/silent-packet-cache.test.ts` |
