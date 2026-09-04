# SPEC provenance

## What this is, and why it exists

34 comments across 18 files in this repo cite two design documents —
`SPEC.md` and `SPEC-2-PROFILES.md` — that do not exist anywhere in this
repo, in `interview-os`, or in any sibling worktree checked on 2026-09-04.
They were design docs that never got committed.

Those citations are not decorative. They are the only surviving record of
*why* several load-bearing behaviors exist: the `POST /api/telemetry` guard
order, the EU/UK durable-storage rule for `visitor_id`, the rule that a
pooled ("uncorrected") rate must always render with that word attached, and
others. Deleting the citations would delete the only record of intent.
Rewriting all 34 to point at code instead loses the section grouping, which
is itself information — several citations to the same `§N` are corroborating
each other.

So: one document that makes every citation resolve to *something*, built by
reading what each citing comment claims its section requires and grouping
those claims back under their section numbers. This is a reconstruction from
the citations, not a copy of the lost spec.

**This file is PROVENANCE, NOT THE SPEC.** It records what the code *claims*
the spec required — it cannot record anything the original spec said that no
code happens to cite, and a section backed by a single citation is thin
evidence. Where this file and the code disagree, **the code is the fact** —
fix this file, not the code.

## Regenerating the citation inventory

```
git grep -nP '\bSPEC(-2(-PROFILES)?)?(\.md)?\b' -- . \
  | grep -vE 'PORTAL-REDESIGN-SPEC|EDITORIAL-PASS-SPEC'
```

PCRE `\b` is required — POSIX ERE has no `\b` and the pattern silently
matches nothing; omitting a boundary entirely over-matches unrelated words
like `SPECIFIER`/`ASPECT`. The `-v` filter excludes two unrelated documents
(`PORTAL-REDESIGN-SPEC`, `EDITORIAL-PASS-SPEC`) whose names contain `SPEC`
as a substring.

As of 2026-09-04 this returns 34 lines across 18 files.

**Line numbers in this file drift.** Every citation below pairs a line
number with a short quoted anchor from that line — the number is a hint,
the quoted text is what actually makes the citation resolvable once a file
is edited and its lines shift. Re-derive from the `git grep -P` command
above; never trust a stored line number on its own.

## Rule for new code

**Do not add new `SPEC §N` citations.** `SPEC.md` and `SPEC-2-PROFILES.md`
do not exist — a new citation to either only recreates this problem for the
next reader. Cite the code that implements the behavior, or cite this file.

## Section map — SPEC.md (telemetry ledger: ingest + client)

Reconstructed from the citations themselves. Each row's description is what
the citing code says its section requires — verified against the cited
file:line, not assumed.

| § | what the citing code says it requires | citations |
|---|---|---|
| §1 | A click log needs a true impression denominator to be interpretable at all — the reason impression dedupe is keyed on `${queryId}:${jobId}`, not `jobId` alone. | `src/lib/jobs/impression-batch.ts:21` ("a click log needs a true impression denominator") |
| §2 | Events carry `position` (and `query_id`) so a position-corrected CTR is computable downstream. | `src/lib/analytics/events.ts:77` ("the ledger can compute a position-corrected CTR"), `:173` ("a position-corrected CTR needs") |
| §3 | Role `pipeline` owns `intervu.telemetry_events`. | `deploy/db-box/telemetry-derived.sql:30` ("Owned by `pipeline`") |
| §4 | `POST /api/telemetry`'s guard order, numbered 1–10 in `route.ts`'s own doc comment (guard 2 = batch-size cap; guard 7 = per-session + per-IP rate limit). | `src/app/api/telemetry/route.ts:9` ("Guard order follows SPEC §4 exactly"), `src/lib/telemetry/ingest.ts:9` ("Guard order mirrors SPEC §4 exactly"), `src/lib/telemetry/client.ts:25` ("cap (SPEC §4 item 2)"), `src/lib/telemetry/rate-limit.ts:2` ("SPEC §4 guard 7") |
| §5 | Client-side ledger behavior: EU/UK visitors get a consent-gated, non-durable (`sessionStorage`) `visitor_id` instead of `localStorage`; `query_id` propagates from a rendered result set through `result_clicked`/`apply_clicked`/impressions, re-arming on a REFINED query but not across pagination; every client-side failure (storage, fetch, beacon) drops silently — telemetry must never surface an error to a visitor. | 14 citations — see the inventory command above (no fixed anchors here by design: re-run the command rather than trust any stored list) |
| §7 | `job_heartbeats` is a proof-of-life table: one current-state row per `job_name`, upserted every run. | `deploy/db-box/telemetry-derived.sql:206` ("is owned by deploy/db-box/telemetry-schema.sql") |
| (unnumbered) | If a number was not actually measured, stop and report rather than fabricate it — `query_daily` and parts of `company_daily` are left empty for exactly this reason today. | `scripts/roll-up-telemetry.ts:48` ("Per SPEC.md's own rule"), `:54` ("SPEC.md models") |

**NOT CITED ANYWHERE: §6, §8.** The reconstruction is partial by
construction — these sections may have existed in the original spec, but no
comment in this repo says what they required.

## Section map — SPEC-2-PROFILES.md (Lane F: derived / profiles)

| § | what the citing code says it requires | citations |
|---|---|---|
| (header) | The derived layer is called "Lane F." | `deploy/db-box/telemetry-derived.sql:9` ("Telemetry DERIVED layer — Lane F") |
| §2 | A posting-structure extractor: every field is a fact read directly off a job posting, never an inference; `NULL` means "not stated" and is itself a finding. | `src/lib/telemetry/features.ts:2` ("Posting-STRUCTURE extractor") |
| §3 | `job_daily` and `company_daily` carry the exact same metric columns (impressions/clicks/applies/saves/dismissals/median_dwell_ms/mean_position) over different grouping keys. | `src/lib/telemetry/daily-rollup.ts:3` ("SPEC-2-PROFILES.md §3") |
| §5 | Position is never collapsed out of the key — `feature_outcomes` keys on `(feature, bucket, position)` exactly, and a pooled rate must always be labeled and rendered with the word "uncorrected." | `deploy/db-box/telemetry-derived.sql:188` ("position is never collapsed into the"), `src/lib/telemetry/feature-outcomes.ts:2` ("Position-corrected rates over"), `:41` ("rendered with the word \"uncorrected\"") |
| §8 | The nightly pipeline order: step 1 is `build-job-features`, steps 2/3 are `roll-up-telemetry`. | `scripts/build-job-features.ts:5` ("SPEC-2-PROFILES.md §8 step 1"), `scripts/roll-up-telemetry.ts:6` ("SPEC-2-PROFILES.md §8 step 2/3") |

**NOT CITED: §1, §4, §6, §7.** Same caveat as above — absence here means
no code cites them, not that they didn't exist.
