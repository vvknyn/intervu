/**
 * The one place the phrase "ghost job" survives outside `/research/ghost-jobs`.
 *
 * Two audiences want two different words for the same thing:
 *
 * - **Search engines / people already in the know.** "Ghost job" is what gets
 *   typed into Google, and it is what the research page ranks for. Deleting it
 *   from titles and descriptions would cost real acquisition for no reader
 *   benefit — nobody reads a `<title>` to learn a concept.
 * - **Somebody using the product.** A nurse scanning a results page has very
 *   likely never met the term. Inside the product the verdicts therefore read
 *   "Actively posted" / "Worth verifying" / "Possibly stale" (see `GHOST_META`,
 *   lib/jobs/presentation.ts) — plain status language that needs no glossary.
 *
 * Routing the surviving uses through this module makes that split ONE recorded
 * decision instead of a dozen strings that merely escaped a rename. It also
 * lets `tests/unit/plain-language.test.ts` enforce the rule structurally: raw
 * "ghost" prose anywhere in `src/` outside the research route fails the suite,
 * with no allowlist of file names to keep in sync — a name-enumerating guard
 * decays the moment somebody adds a file, which is how the previous rename
 * ended up half-applied in the first place.
 *
 * The DATA never changes shape here: `ghost_badge` (a live Meili facet), the
 * `ghost_job` report reason, the `ghosts` URL param and the MCP
 * `includeGhostFlagged` argument are wire contracts and stay exactly as they
 * are. This module is about words on a screen, nothing else.
 */

/** The search term itself. Interpolate; don't restate it as a literal. */
export const GHOST_JOB_TERM = "ghost job";

/** Title of the research explainer, used by anything that links to it. */
export const GHOST_JOB_RESEARCH_TITLE = "Ghost Job Research";
