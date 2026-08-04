# RANKING.md — how jobs are ranked for the digest

This file IS the relevance algorithm. The digest (SKILL.md §1) ranks search
results by applying this rubric top to bottom. Tuning relevance = editing
this file — never SKILL.md. Precedence, absolute and in this order:

1. The user's own `fit_notes` (from `get_preferences` → `answers.custom`)
2. This rubric
3. Your model judgment (only where 1 and 2 are silent)

## Load the pipeline first (one call, before any scoring)

`mcporter call intervu-cc-mcp.get_applications --args '{"limit":100}' --output json`

The user's own pipeline outranks every signal below: a job they are already
in the running for is not a discovery. Ranking without this call is how the
digest ends up pitching a company the user is interviewing with tomorrow —
which reads as an agent that isn't paying attention to their week.

## An empty result set is a FINDING, never a quiet "nothing today"

The user's stored `search` filters can be tighter than their market. When the
search run with their configured filters returns zero hits, the digest has
found something worth saying — it has NOT found nothing.

Never send "no new jobs today" off a single zero-result search. Instead:

1. Re-run widening ONE constraint at a time, in this order, stopping as soon
   as there are candidates:
   - `postedWithinDays` — the API accepts ONLY `7 | 30 | 90` (verified in
     `src/app/api/mcp/route.ts`; anything else is rejected as "Invalid input",
     and `90` is silently narrowed to the 30-day bucket with a server note).
     So the ladder is exactly 7 → 30. Do not invent intermediate values.
   - `location` — drop the region qualifier ("Toronto, Ontario" → "Toronto"),
     then drop location entirely if the user's preferences allow remote.
   - `query` — fall back to the single strongest role term rather than the
     full comma-separated list.
2. Rank whatever that yields by the rubric below, exactly as normal.
3. SAY WHAT YOU WIDENED AND WHY, in one line at the top of the digest: which
   constraint was binding, what the user's setting is, and what it had to
   become to find anything — e.g. "nothing posted in your last-7-days window;
   these are the freshest matches, oldest 11 days. Your window may be tighter
   than your market."

A digest that silently reports nothing teaches the user their market is dead,
when what actually happened is that a setting excluded everything. That is
the worst failure this file can produce: it is invisible, it looks like the
product working, and it repeats every single day.

If even the fully-widened search is empty, say THAT explicitly too, naming
the filters tried — an honest "your corpus has no match for these roles in
this region at any recency" is a real answer the user can act on.

## Hard excludes (never in the top 3, never on the bench)

- Same role already in the pipeline at any status other than `rejected` or
  `withdrawn` — they've seen it; re-surfacing it is noise, not a find.
- Violates any rule in the user's `fit_notes`.
- `ghost_badge` is `likely_ghost` — flagged-fake postings are never
  recommended even when they match perfectly.
- Seniority mismatch by more than one level in either direction (a senior
  person is not shown entry roles; an entry person is not shown director
  roles), inferred from the resume's years and titles.
- Location the user cannot work: not remote AND not within the user's
  stated location/region, unless their preferences allow relocation.

## Scoring signals (strongest first)

1. **Title/role match** — the job title or its obvious synonyms match the
   user's target roles (`search.query`). A dead-on title match outranks
   everything below.
2. **Seniority fit** — level matches the resume's trajectory (the NEXT
   sensible step counts as a match, not just the current level).
3. **Skill overlap** — the job's named requirements appear in the resume's
   actual experience (not just its skills list). Cite the overlap in the
   why-line.
4. **Recency** — newer postings beat older ones; a posting under 48h old
   gets a strong boost (early applicants get read).
5. **Salary** — meets or beats `search.salaryMin` when the posting states
   pay. A posting that states pay beats one that hides it, all else equal.
6. **Ghost-risk margin** — `clear` beats `caution` on ties. Never use
   scoring to rescue a `caution` posting into the top 3 over a `clear` one
   of similar fit.

## Company-signal enrichment (finalists only)

After scoring produces ~5 finalists and BEFORE picking the final top 3,
spend one quick lookup per finalist on company health:

- **News check (your own web tools):** recent layoffs, hiring freezes,
  acquisition turmoil → drop or demote, and say why in the why-line.
  Fresh funding, strong growth coverage → boost, and cite it ("Series C
  three weeks ago — hiring push is real"). No news found = neutral; never
  invent a signal you didn't see, never cite a source you didn't read.
- **Our own corpus signals, when present on the job record:** a company
  whose postings historically close (hires happen) beats one that lets
  them rot; rising open-role counts corroborate a genuine hiring push.
  Absent fields are neutral — never guess at data we don't serve.

This step is capped: finalists only, one lookup each — never bulk-search
news for all 20 results.

## Companies already in the pipeline (annotate, never pretend)

A DIFFERENT role at a company the user is already engaged with is allowed in
the top 3 — people do get hired into a second team — but it is never
presented as a fresh discovery. The why-line must lead with where they
already stand ("you interview here Thursday — this is the adjacent PM req,
same org"). Silently listing it as a new opportunity makes the user correct
the agent, which is the one thing the digest exists to avoid.

`interviewing` and `offer` outrank `applied`: mentioning a live conversation
matters more than mentioning a form they submitted a month ago.

## Tie-breakers, in order

Company has other live postings in the same family (hiring push, not a
one-off) → posting states a salary → shorter apply flow (no account wall
recorded in `vendorAccounts` state).

## Why-line discipline

Every digest why-line must cite the SPECIFIC rubric signal that put the job
in the top 3 ("payments infra + 0→1 both in your last two roles" — signal
3), never generic praise ("great company!", "strong match!"). If you cannot
write a specific why-line, the job does not belong in the top 3.

## Changelog

- 2026-08-03: initial rubric (extracted from SKILL.md §1 so relevance is
  tunable in one place).
- 2026-08-04 (v4): an empty result set is a finding — widen one constraint at
  a time and say what was widened, instead of reporting "no new jobs today".
  Written after the owner's own saved filters (7-day window + "Toronto,
  Ontario") were measured returning zero every run while a 30-day window
  returned 14 — a silently empty digest that looked like a quiet market.
- 2026-08-04 (v3): pipeline awareness — `get_applications` is loaded before
  scoring; already-in-flight roles are hard-excluded and other roles at those
  companies are annotated with where the user already stands. Written after
  the digest recommended a company the user was interviewing with the next
  day and he had to say so himself.
- 2026-08-03 (v2): company-signal enrichment — agent-side news check for
  finalists + corpus health fields when present (owner: rank by how the
  company is actually doing, not just the posting).
