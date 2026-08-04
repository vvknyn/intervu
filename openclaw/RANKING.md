# RANKING.md — how jobs are ranked for the digest

This file IS the relevance algorithm. The digest (SKILL.md §1) ranks search
results by applying this rubric top to bottom. Tuning relevance = editing
this file — never SKILL.md. Precedence, absolute and in this order:

1. The user's own `fit_notes` (from `get_preferences` → `answers.custom`)
2. This rubric
3. Your model judgment (only where 1 and 2 are silent)

## Hard excludes (never in the top 3, never on the bench)

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
