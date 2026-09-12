# Silent packet (on-device résumé pre-warm)

When a user opens a **high-fit** job on job detail, Velai pre-warms a tailored résumé draft in the background. The Customize affordance becomes **Review packet** once a meaningful packet is ready or still warming.

## Trigger

All of the following must be true:

1. Job detail is visible (client mount).
2. Local AI is enabled (`?localAi=1` or Settings toggle → `velai.localAi.enabled`).
3. The on-device résumé is usable for Rank (`resumeIsUsable`).
4. Fit score is **≥ 75** — same threshold as the brand match chip (`SILENT_PACKET_FIT_THRESHOLD` / `MATCH_CHIP_BRAND_THRESHOLD`).
5. **On-device AI consent** is granted (`velai.localAi.consent`). Without consent, no silent pre-warm runs — CTA stays **Customize**; users can still open Customize and choose **Use a rules draft** explicitly.

`sort=fit` does **not** bypass a low score. A job can appear in a fit-ranked list and still skip pre-warm when its computed fit is below 75, so weak hits never burn the on-device model.

Pre-warm debounces **~1.2s** after the job becomes visible. Navigating away, changing job id, or unmounting cancels the debounce; in-flight runs ignore their result on cancel.

## Meaningful diff gate

A draft is only “ready” when `hasMeaningfulDiff(draft)` is true:

- `summaryAfter` (normalized whitespace) ≠ `summaryBefore`, **or**
- any bullet has `after.trim() !== before.trim()`.

Identical before/after bullets (common with rules-only heuristics on some postings) do **not** light **Review packet**. Heuristic drafts remain available via **Customize → Use a rules draft** inside the dialog.

`shouldShowReviewPacket` shows the CTA when `status === 'warming'` **or** (`status === 'ready'` **and** `hasMeaningfulDiff(draft)`).

## Consent and engine

- **With consent**: runs the on-device model (`allowModel: true`).
- **Without consent**: no silent pre-warm; no rules-only silent cache.
- Failed, empty, or no-op drafts stay invisible (no error toast, CTA stays **Customize**).

## Cache

- **Key:** `silentPacketCacheKey(jobId, resumeFingerprint)` → `{jobId}:{fingerprint}` in a single localStorage blob (`velai.localAi.silentPacket`).
- **Fingerprint:** stable hash of profile + experience bullets + summary (pure function in `src/lib/local-ai/silent-packet.ts`).
- **Retention:** last **10** entries (LRU prune).
- **Write gate:** `writeSilentPacketCache` only when `hasMeaningfulDiff`; `loadFromCache` rejects drafts without meaningful diffs.
- **Privacy:** draft text never leaves the device; no server upload; no new settings surface.

Multiple `LocalCustomizePanel` mounts (JobDetail action row, action bar, document) share one module-level in-flight map so the model never runs twice for the same job + résumé.

## Packet dialog actions

When a meaningful draft is showing:

- Helper under title: *Tailored on-device for this job. Download to apply, or accept to use for Rank.*
- **Download PDF** — primary footer button (real apply path).
- **Accept for Rank** — secondary; writes the on-device résumé used for Rank (`writeLocalAiResume` + `onAccept`).
- **Copy** — quiet text control.

## Try it

1. `PORT=3002 npm run dev` (or your worktree port).
2. Open `/jobs?localAi=1`, grant on-device AI consent, upload or restore a usable on-device résumé.
3. Open a job detail where the match chip shows **≥ 75** (brand outline).
4. Wait ~1–2s — the button should read **Review packet** (brand-outline, not inverted Apply).
5. Click **Review packet** — the dialog opens with the draft immediately (no reset/regenerate when cached).
6. Tap **Download PDF** to apply, or **Accept for Rank** to update Rank on this device.
7. Open a low-fit job (< 75) — CTA stays **Customize**; no background tailor.

## Onboarding and résumé nudge

- **Prefs onboarding** (`PrefsOnboardingDialog`): guests with local AI see the dialog even without a résumé. First block is in-sheet upload/paste; **Save & rank** stays disabled until `resumeIsUsable`.
- **Toolbar nudge** (`shouldShowResumeNudge`): when local AI is on and no usable résumé, `/jobs` shows *Add résumé to unlock ranked jobs* near the toolbar (`data-testid="jobs-resume-nudge"`). Does not block browsing.

## Mobile (~390px)

Same Next.js app at phone width (iPhone 13 viewport in `tests/e2e/mobile.spec.ts` — resize the browser or run that spec).

- **Document action bar** (`JobDetailDocument` → `JobDetailActionBar`, `lg:hidden`): Apply reads **Apply** (full label in `aria-label`); Customize / packet uses the **compact** trigger. When a silent packet is ready or warming, the visible label is **Packet** (`aria-label` stays **Review packet**).
- **SERP sheet action row** (`JobDetail`): full **Review packet** / **Customize for this job** labels — not compact.
- **Packet dialog**: below `sm`, full-width bottom sheet (`max-h-[95dvh]`), scrollable draft body, sticky footer — Copy, **Download PDF** (primary), and **Accept for Rank** stay reachable (PDF is never `hidden sm:`).
- **Prefs onboarding** (`PrefsOnboardingDialog`): same bottom-sheet treatment; résumé upload and inputs are full width on small screens.

Pre-warm runs on every viewport where `LocalCustomizePanel` mounts — no `lg:` / hover gate.

### Verify mobile

1. Dev server on `/jobs?localAi=1`, open a high-fit job at ~390px width.
2. Document page (`/jobs/[slug]`): sticky bar shows **Apply** + **Packet** (after ~1–2s) + bookmark.
3. Open **Packet** — dialog fills the bottom of the screen; scroll the draft; tap **Download PDF**.
4. Cold visit `/jobs` — prefs onboarding sheet pins to the bottom with résumé upload first.

## Code map

| Piece | Path |
|---|---|
| Gate, fingerprint, meaningful diff, debounce scheduler | `src/lib/local-ai/silent-packet.ts` |
| localStorage cache | `src/lib/local-ai/silent-packet-cache.ts` |
| React hook + panel CTA | `src/lib/local-ai/use-silent-packet.ts`, `src/components/jobs/LocalCustomizePanel.tsx` |
| Prefs onboarding + résumé nudge | `src/lib/jobs/prefs-onboarding.ts`, `src/components/jobs/PrefsOnboardingDialog.tsx`, `src/app/jobs/page.tsx` |
| Unit tests | `tests/unit/silent-packet.test.ts`, `tests/unit/silent-packet-cache.test.ts`, `tests/unit/jobs-prefs-onboarding.test.ts` |
