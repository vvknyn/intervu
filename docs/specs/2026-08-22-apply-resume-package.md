# Apply-flow + résumé package — build spec

Vivek, 2026-08-22: *"When the user clicks apply, the flow forces the user to use
the claude and external AI workflow when we have a built in AI… perfect that
workflow… also, there is no way to see or work with or modify the resume for a
certain company or just generally modify the resume."*

Four decisions he made, which this spec implements verbatim:

1. Apply dialog: **built-in AI primary**, external Claude/ChatGPT handoff
   secondary, "Continue to the posting" always visible.
2. Résumé home: **new top-level `/resume`** in the nav.
3. **Both halves ship as one package.**
4. Billing: **charge coins from the first use** through the existing credit
   gate; BYOK stays free.

## The constraint that outranks the feature

intervu exists in opposition to an autofill that invents credentials nobody
claimed (`ApplyIntentDialog.tsx:29-36`). So the built-in tailoring may only
**reword, reorder and re-emphasise what the user already wrote**. It may never
add an employer, title, date, degree, skill, tool or number.

Prompt instructions are not a guarantee — models drift. The guarantee is
`enforceResumeIntegrity()` (Section A2), a pure function that diffs the model's
proposal against the original and **reverts anything invented** before the
result is ever shown. Whatever it reverts is counted and surfaced to the user.

---

## Section A — server (coder A)

Files owned: `src/lib/resume/tailor-integrity.ts` (new), its test file,
`src/lib/llm/models.ts` (one addition), `src/actions/tailor-resume.ts` (extend).

### A1. Contracts — implement exactly, other coders build against these

Append to `src/actions/tailor-resume.ts` (keep `saveTailoredVersion` as-is):

```ts
export interface TailorForJobInput {
    jobId: string;
    jobTitle: string;
    companyName: string;
    jobText: string;        // posting description, plain text
    jobUrl?: string;
}

/** "structured" — base résumé is ResumeData, so a diff and a saved version are
 *  possible. "advisory" — base résumé is plain text only: recommendations are
 *  real, but there is nothing structured to diff or save, and we say so rather
 *  than inventing a structure. */
export type TailorMode = "structured" | "advisory";

export interface TailorForJobResult {
    mode: TailorMode;
    analysis: JobAnalysis;
    recommendations: TailoringRecommendation[];
    /** Present only when mode === "structured". */
    tailored?: {
        summary: string;
        experience: ResumeExperience[];
        competencies: ResumeCompetencyCategory[];
    };
    /** Present only when mode === "structured" — what it started from, so the
     *  client can diff and pass both halves to saveTailoredVersion. */
    original?: ResumeData;
    /** How many model suggestions the integrity check threw away. */
    dropped: number;
}

export async function tailorResumeForJob(
    input: TailorForJobInput,
): Promise<{ data?: TailorForJobResult; error?: string; needs?: "auth" | "resume" }>;

export interface TailoredVersionSummary {
    id: string;
    versionName: string;
    companyName: string;
    positionTitle: string;
    recommendationCount: number;
    createdAt: string | null;
    updatedAt: string | null;
}

export async function fetchTailoredVersionsAction():
    Promise<{ data?: TailoredVersionSummary[]; error?: string }>;

export async function deleteTailoredVersionAction(id: string):
    Promise<{ error?: string }>;
```

Behaviour notes:

- `needs: "auth"` when `getServerUser()` is null; `needs: "resume"` when
  `getBaseResumeForUser(uid)` returns `{ source: "none" }`. Neither is an
  `error` — the client renders a specific CTA for each.
- `fetchTailoredVersionsAction` reads Firestore `tailored_resumes` where
  `user_id == uid`, newest `updated_at` first. `deleteTailoredVersionAction`
  **must verify `user_id === uid` before deleting** — copy the ownership check
  already in `saveTailoredVersion:109`.
- Sort in code if a Firestore composite index would otherwise be required;
  do not silently return unsorted rows.

### A2. `enforceResumeIntegrity` — the actual guarantee

New pure module `src/lib/resume/tailor-integrity.ts` (no Firestore, no LLM, no
`"use server"` — must be directly unit-testable):

```ts
export interface IntegrityVerdict {
    tailored: { summary: string; experience: ResumeExperience[]; competencies: ResumeCompetencyCategory[] };
    dropped: TailoringRecommendation[];
    violations: string[];   // human-readable, for logs
}

export function enforceResumeIntegrity(
    original: ResumeData,
    proposed: { summary?: string; experience?: ResumeExperience[]; competencies?: ResumeCompetencyCategory[] },
    recommendations: TailoringRecommendation[],
): IntegrityVerdict;
```

Rules — each one **reverts to the original**, never merely warns:

1. **Experience identity.** The tailored set must carry exactly the original
   ids. Any entry added, missing, or whose `company` / `role` / `dates` differ
   from the original (after trim) → that entry reverts wholesale.
2. **No invented numbers.** Tokenise numbers in a tailored `description`
   (percentages, currency, `12k`/`3M`, and bare integers ≥ 2 — ignore 0/1 and
   ordinary years already present). Any number token absent from that same
   entry's original description → the entry reverts. This is the "grew revenue
   40%" class.
3. **Profile and education are never sent to the model and never returned.**
   Assert they are absent from the proposal; if present, record a violation and
   ignore them.
4. **No invented skills.** Every tailored competency skill must already appear
   (case-insensitive, trimmed) in the original competencies *or* somewhere in
   the original experience descriptions or summary. Unmatched skills are
   removed from the category. This is the founding-wound case verbatim.
5. **Summary.** May not introduce an employer name absent from the original
   experience, nor a number absent from the original summary + experience.
   Violation → summary reverts to the original.

Any recommendation whose `suggested` content was reverted moves into `dropped`
and out of the returned `recommendations`.

### A3. Tests — `enforceResumeIntegrity`

Vitest, colocated per repo convention (check a sibling in `src/lib/**` first).
Per the project's generic-fix rule, cover cases **beyond** the one that
motivated each rule:

- invented employer in experience → reverted
- invented metric ("increased retention 40%") → that entry reverted, others kept
- altered dates → reverted
- invented skill in competencies → removed, real skills kept
- invented employer in the **summary** → summary reverted (different section
  from the experience case, proving the rule is class-wide)
- legitimate rewording (same facts, better ordering/emphasis) → preserved
  untouched, `dropped` empty
- education/profile present in a malicious proposal → ignored, violation logged

### A4. The LLM call

Use the existing free-first seam, **do not write a new config ladder**:

```ts
const result = await generateGenericJSON(prompt, undefined, TAILOR_FREE_LADDER);
```

`generateGenericJSON` (`src/actions/generate-context.ts:684`) charges exactly
once above the ladder walk (`fetchJSON` → `chargeIfSharedKey`, line 171), which
is precisely decision 4: shared key metered, BYOK free, one charge per run no
matter how many rungs execute.

Add to `src/lib/llm/models.ts`, next to `RESUME_PARSE_FREE_LADDER:61`:

```ts
/** Same two structured-output free rungs as résumé parsing; tailoring is the
 *  same shape of work (JSON in, JSON out, one résumé of context). */
export const TAILOR_FREE_LADDER = [
    "dots-studio/dots-3-note-preview:free",
    "nvidia/nemotron-nano-9b-v2:free",
] as const;
```

`AUTH_REQUIRED:` / `OUT_OF_CREDITS:` prefixes must reach the caller verbatim —
`formatError` already preserves them (`generate-context.ts:85-87`). Do not
wrap or rewrite them.

Prompt requirements: cap `jobText` (≈6000 chars, like `resume.ts:190`'s 8000
cap on résumé text); state the no-invention constraint explicitly; ask for
`analysis`, `recommendations[]` and the three tailored sections only. Never
send `profile` or `education`.

---

## Section B — apply dialog (coder B)

Files owned: `src/components/jobs/ApplyIntentDialog.tsx`,
`src/app/jobs/page.tsx` (mount only, ~line 4645),
`src/components/jobs/PublicJobDetail.tsx` (mount only, line 67).

### B1. Widen the contract at the chokepoint

Today both mounts narrow a full `PublicJob` down to `JobHandoffInput`
(`{id,title,company,location}`) with their own inline mapping, which is why the
description and company domain — everything the built-in path needs — get
dropped at the door. Change the prop to `job: PublicJob | null` and **move the
`PublicJob → JobHandoffInput` mapping inside the dialog**, one implementation,
using `decodeText(job.title)`, `job.company || "Unknown company"`,
`locationText(job) || null` (both helpers: `@/lib/jobs/presentation`).

Check both call sites' current mapping before you delete them. If they differ,
adopt the richer one and say so in the commit body.

### B2. States

**idle**
- Title: `Tailor your résumé for this role`
- Body, plain and honest: intervu rewords and reorders what your résumé already
  says so it lands against this posting. It never adds a skill, employer or
  number you didn't write.
- Primary, full width, brand: `Tailor my résumé`
- Then a rule, then the secondary lane, visually quieter (outline, not
  brand-filled): `Or hand it to your own AI` + the existing Claude/ChatGPT
  buttons, keeping `getSavedHandoffClient` / "Use a different AI" behaviour.
- Always visible, outline: `Continue to the posting`
- Footer unchanged (`How connecting works`, `Don't show this again`).

**working** — primary swaps to a disabled progress state (`Reading the
posting…`). `Continue to the posting` stays live throughout.

**result**
- `N changes suggested`, then the recommendations: title, priority chip,
  reasoning. Cap at 6 visible with a "show all" if more.
- If `dropped > 0`, a quiet line: `X suggestions were discarded because they
  added something your résumé doesn't say.` Do not hide this — it is the
  product's differentiator made visible.
- `mode === "structured"`: primary `Save for {Company}` → `saveTailoredVersion`
  with `versionName: "{Company} — {Title}"`, both original and tailored halves,
  `companyName`, `positionTitle`, `recommendations`. On success → toast, then
  `Open in the editor` → `/resume?v={id}`.
- `mode === "advisory"`: no save button. Instead `Structure your résumé to save
  versions` → `/resume`. Never fake a saved version from unstructured text.
- `Continue to the posting` still present.

**blocked**
- `needs === "auth"` → `Sign in to tailor` → `/login?next={pathname}`. The
  external handoff lane must keep working signed-out, exactly as today.
- `needs === "resume"` → `Add your résumé first` → `/resume`.
- Error starting `OUT_OF_CREDITS:` → render through the existing
  `lib/llm/credit-copy` module rather than raw text.

### B3. Do not break the popup path

`onContinue()` and the handoff `window.open` must stay synchronous inside their
own click handlers — a popup blocker kills `window.open` the moment it runs
from a timer, an effect, or after an `await`. The docblock at
`ApplyIntentDialog.tsx:38-42` explains this; keep it and keep it true. The
tailoring call is `await`-ed, but it never leads to `window.open` in the same
handler, so it is safe.

---

## Section C — `/resume` (coder C)

Files owned: `src/app/resume/page.tsx` (new), a new
`src/components/resume/TailoredVersionsList.tsx`,
`src/components/layout/nav-tabs.tsx` (one entry).

### C1. Compose, do not fork

`YourResumeSection` (`src/components/settings/YourResumeSection.tsx:163`)
already does view / upload / live-edit and already takes `embedded` and
`onEditorActiveChange`. Mount it — do **not** write a second résumé UI. It was
just made phone-usable by PR #248; forking would strand that fix.

Page shape:
- Signed out → the repo's standard signed-out state with a sign-in CTA (copy
  the pattern `/yours` uses; do not invent a new one).
- Section 1 — **Your résumé**: `<YourResumeSection embedded … />`
- Section 2 — **Tailored versions**: `TailoredVersionsList`, fed by
  `fetchTailoredVersionsAction`. Row: company · position · date · `N changes`.
  Row actions: Open (→ editor), Download PDF, Delete (inline confirm — reuse
  the `confirmingDelete` pattern already in `YourResumeSection:305`).
- Empty state, honest: `No tailored versions yet. When you apply to a role,
  you can tailor your résumé for it from the apply dialog.`

PDF download must call the existing renderer (`renderResumePdf`, reached via
`src/lib/pursuits/download-resume.ts:28`) — do not roll a second PDF path.

### C2. Nav

Add one entry to `NAV_TABS` (`nav-tabs.tsx:57`) — desktop `TopBar` and
`MobileTabBar` both render off that array, so one entry covers both:

```ts
{ label: "Resume", shortLabel: "Resume", href: "/resume",
  testId: "topbar-resume", match: (p) => p.startsWith("/resume"), icon: ResumeIcon }
```

Order: **Jobs · Resume · Tracker · Connect** (find the role, tailor for it,
track it). Icon: a document glyph from `@phosphor-icons/react` (already the
repo's icon set), wrapped like the existing `TrackerIcon`.

⚠️ This takes the mobile bar to five tabs (four + Account). Five is the
platform maximum and the grid auto-sizes off `MOBILE_TABS.length`, but it must
be **screenshotted at 390px** to confirm no overflow or label clipping.

---

## Definition of done (all three)

Local, before reporting: `npx tsc --noEmit` clean; lint clean on changed files;
vitest passes (Section A must show its new tests passing by name).

**Do not run `npm run build`** — coders B and C run concurrently in one
worktree and would collide in `.next`. The orchestrator runs the build.

Rendered screenshots are required — a claim about a visual surface is not
accepted without one:
- B: dialog idle state, and the result state (a stub/fixture is fine if the
  live LLM path is impractical — say which it was).
- C: `/resume` at 1440px, and the nav at 390px showing five mobile tabs.

Report what was **pixel-verified** separately from what merely compiled.
