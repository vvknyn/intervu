# BYOK option removal — report

## Key finding
The named "model switcher" key-entry UI (`ModelSettings.tsx`) and its whole modal-era
predecessor (`ConnectionCard.tsx`/`CostBadge.tsx`/`SecurityBadge.tsx`, `guest_api_keys`
localStorage flow) were **already unmounted/orphaned** before this task — cut in the
Aug 5 "automation-first" pivot (`e8a37ee`). `SettingsContainer.tsx` has no Models tab.
So the live surfaces needing removal were the *mentions* (error copy, tooltip, privacy
notice), not a reachable entry form.

## Removed (files)
- `src/components/settings/ModelSettings.tsx` — key-entry form; whole purpose was BYOK, so deleted entirely (not split).
- `src/components/settings/ConnectionCard.tsx`, `CostBadge.tsx`, `SecurityBadge.tsx` — older BYOK card UI, zero live imports.
- `src/lib/llm/pricing.ts` — only consumer was `CostBadge.tsx`.
- `src/actions/llm-settings.ts` (`validateProviderKey`) — only consumer was `ModelSettings.tsx`.
- `tests/e2e/api-key-persistence.spec.ts` — tests a `guest_api_keys` localStorage + modal UI that no longer exists anywhere in `src/`; deleting is honest, not a rewrite target.

## Removed (functions, `src/actions/profile.ts`, `src/lib/validation.ts`)
Write paths with zero remaining callers after `ModelSettings.tsx` deletion: `saveProviderApiKey`, `saveProviderApiKeys`, `loadProviderApiKeys`, `updateModelSettings`, `updateModelPreference`, `ProviderApiKeys` interface, `saveProviderApiKeySchema`. `fetchProfile()` trimmed to drop `custom_api_key`/`preferred_provider`/`preferred_model`/`provider_api_keys` (only consumer was `ModelSettings.tsx`; `stories/page.tsx` only reads `is_admin`).

## Kept (legacy honoring)
- `profile.ts:57-70` `getUserLLMConfig()` — READ path, marked with the required comment block pointing at this report's removal date (2026-08-08) and naming the deleted UI + removal condition.
- `credit-gate.ts` `isBYOK` bypass (`chargeIfSharedKey`) — unchanged logic.
- `CreditBalance.tsx:37-48` `isBYOK` display branch (icon/label "Your API key") — truthful legacy state, decision #3.

## Rewritten copy (BYOK-pointing → credits-world truth)
- `credit-gate.ts` — extracted `AUTH_REQUIRED_MESSAGE`/`OUT_OF_CREDITS_MESSAGE` as single-source exported consts (was inline, duplicated intent in 2 throw sites); dropped "(or add your own key in Settings)" / "Add your own API key in Settings".
- `CreditBalance.tsx:34` — tooltip: dropped "Add your own API key in Settings to go unlimited."
- `generate-context.ts:97-108` (`formatError`) — 401/missing-key/model-not-found messages no longer say "in the model switcher"; quota message no longer says "(use the model switcher)".
- `resume.ts:209` — "check your API key configuration in the model switcher" → "Please try again in a moment."
- `providers.ts:45` — shared-key 402 message: "Add your own OpenRouter or Groq key in Settings, or top up your OpenRouter balance." → "AI is temporarily out of credits on our end. Please try again in a bit." (this was an ops-facing message wrongly told users to self-serve).
- `privacy-notice.tsx:40-47` — dropped "bring-your-own-key tool" framing; rewritten to match `privacy/page.tsx`'s "AI processing" section (transient send to OpenRouter/Groq, not stored, not trained on).
- `tour-steps.ts` — deleted the dead `data-tour="model-switcher"` dashboard step ("Switch between Groq, Gemini, and OpenAI models") — selector matched no DOM element anywhere in `src/`.

## grep-proof: `grep -rin "your api key\|bring-your-own-key\|model switcher" src/`
| Hit | Justification |
|---|---|
| `CreditBalance.tsx:46` `label = "Your API key"` | Truthful legacy display state for existing BYOK users (decision #3), not an upsell — no "Settings" pointer nearby. |

That's the only hit. `tests/unit/credit-gate-copy.test.ts` (new) asserts the two hard-block messages never regain an `/api key/i` or `/settings/i` reference.

## e2e decision
- Deleted `api-key-persistence.spec.ts` (as instructed) — feature it tests doesn't exist.
- Fixed `privacy-account.spec.ts:263` — its locator quoted the exact string I removed from `privacy-notice.tsx`; updated to `text=AI features` (assertion is a pre-existing no-op soft-check either way).
- **Not touched, flagged for a separate cleanup**: `storage-persistence.spec.ts`, `api-search-stability.spec.ts` (self-skips without env keys), `auth.spec.ts`, `parallel-loading.spec.ts`, `setup-wizard-fix.spec.ts`, `quirky-messages.spec.ts` (1 line) all assert against the same already-dead `guest_api_keys` localStorage + "Configure API Key" modal mechanism — pre-existing staleness from the same prior pivot, not a casualty of this diff. Rewriting ~6 files' worth of already-broken e2e assertions is out of this task's scope; flagging per "don't take decisions on your own."

## Concerns
`src/lib/copy.ts` `SETUP_NUDGES`/`COMPLETION.setupTitle` (wizard nudge copy, "you need an API key") has zero live consumers (`WelcomeStep` component doesn't exist) — pre-existing dead code, not touched; same reasoning as the e2e sweep above.

## Verification
- `npx tsx --test tests/unit/*.test.ts`: 1384 pass / 3 fail (all 3 = pre-existing werift failures, baseline unchanged).
- `npx tsc --noEmit`: clean, 0 errors.
- `npm run build`: clean, all 41 routes generated.
