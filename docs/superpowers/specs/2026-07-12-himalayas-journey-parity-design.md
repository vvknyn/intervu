# Himalayas Journey Parity Design

**Date:** 2026-07-12
**Status:** Approved for implementation planning, pending user review of written spec
**Product:** Intervu

## Context and goal

Himalayas.app is a remote-job platform with AI career tools. Public and authenticated research showed its strength is simple bounded flows, not necessarily deeper cross-tool integration.

**Goal:** Bring Himalayas-style flow clarity to Intervu's existing overlapping journeys while preserving Intervu shell, navigation, components, brand, personality, ghost-job indicators, prep depth, credits, and BYOK.

This is **flow parity**, not a visual clone and not feature parity for unrelated tools.

## Scope

**In scope (Scope C — all overlaps):** Interview Prep, Resume Builder/Tailor, Cover Letter, Job Search, Application Tracker, STAR Story Bank, Auth/Onboarding.

**Out of scope / non-goals:**

- Conversational voice interviews
- Job alerts
- AI headshots
- Standalone career coach
- Cloning Himalayas IA or visual design
- Replacing Intervu sidebar
- Removing full prep package
- Unrelated backend refactors
- Defining implementation tasks in this document

## Feature matrix

| Capability | Himalayas | Intervu | Gap |
|---|---|---|---|
| Classic mock interview | Bounded sequential session | Learn/Practice question critique; dashboard-first | Both — journey weaker |
| Conversational voice interview | Yes | No | Out of scope |
| Prep package / company recon / reverse / technical / coding / system design | No | Yes — core strength | Intervu-only |
| Resume / tailor | Yes | Yes — more capable but fragmented | Both — journey weaker |
| Cover letters | Yes | Yes — contextual but less discoverable | Both — journey weaker |
| Job search | Yes | Yes — ghost-job differentiation | Both |
| Application tracker | Yes | Yes — capable but procedural/list-oriented | Both — journey weaker |
| STAR stories | Marketing feedback technique | Reusable structured story bank | Both — Intervu stronger |
| Auth / onboarding | Google/email, profile-first | Email/password plus optional setup | Both — journey weaker |
| Alerts / headshots / career coach | Yes | No | Out of scope |
| Credits / BYOK | No | Yes | Intervu-only |

## Locked shared principles

1. **Job-context first** — Every overlapping journey opens from or carries a job; the user never wonders which role they are working on.
2. **One primary action per screen** — Each step has a single obvious CTA; secondary actions stay visually subordinate.
3. **Progressive disclosure** — Show only what the current step needs; deep prep and advanced options appear when relevant, not upfront.
4. **Context travels forward without re-entry** — Job, resume, stories, and application state pass between tools via the shared job-context object; no re-paste or re-search to continue.
5. **Bounded workflows with progress** — Multi-step flows show position (e.g., Question X of N) and completion state; users always know where they are.
6. **Immediate feedback** — Every generative or practice action returns visible, ordered feedback before the next step.
7. **Explicit completion and next action** — End states summarize what happened and recommend one clear next step; no dead ends.
8. **Interruptions preserve state** — Auth refresh, back navigation, and cancel return the user to the same setup and selections; nothing is silently discarded.
9. **Intervu remains Intervu** — Shell, sidebar, components, brand voice, ghost-job indicators, prep depth, credits, and BYOK stay intact; flow clarity is added, not a rebrand.

## Shared job-context object

A product contract — not an implementation schema — that every overlapping journey reads and writes. Users see it as a **compact job header** (company, role, round, status chip) persistent across screens.

### 1) Job identity

`jobId`, `applicationId` (if tracked), `sourceUrl`, `sourceName`, `companyName`, `jobTitle`, `location`, `remoteStatus`, `employmentType`.

### 2) Job content

Original JD, normalized JD, responsibilities, required skills, preferred skills, seniority, compensation (if available), last-refreshed timestamp.

### 3) Candidate context

`selectedResumeId`, `resumeVersionId`, selected STAR story IDs, knowledge-source IDs, candidate profile snapshot used.

### 4) Application artifacts

Tailored resume version ID, cover-letter ID, status, notes, posting-opened/applied timestamps.

### 5) Interview context

Round, role family / technical classification, prep intensity, Learn/Practice mode, `interviewPlanId`, `practiceSessionId`, completed/starred question IDs.

### 6) Provenance (per generated artifact)

JD version, resume version, story/source IDs, generation timestamp.

**Contract rules:**

- Missing optional values must not block unrelated flows.
- Handoffs use IDs and snapshots sufficient to reproduce what generated content used.
- Stale or edited upstream data triggers explicit regenerate decisions — never silent mutation.

## IA and navigation — minimal changes

Keep: **Home**, **Find jobs**, **Interview prep**, **Library**, **Resumes**, **Applications**, **Settings**, and credits/BYOK/account controls.

| Area | Change |
|---|---|
| Home | Becomes launchpad for recent jobs, applications, and preparations |
| Interview prep | Opens start/search/resume landing; full prep package is secondary within plan |
| Resumes | Single visible entry for create/import/tailor; standalone tailor may remain internal |
| Library | Retains STAR Stories and Sources tabs |
| Applications | Remains tracker; stage actions live in detail |
| Cover letters | Contextual only — no sidebar item |
| All workflows | Shared compact job header |
| Auth | Remains modal/interruption pattern |

No Himalayas-style tool-directory nav. No sidebar replacement.

## Journey maps

Each map follows: **entry → setup → mode/choice → action loop → feedback → next action**.

---

### A) Interview Prep (P0)

#### 1. Interview Prep Landing

- **Entry:** Sidebar Interview prep, Home recent prep, Application stage action, Job detail Prepare.
- **Primary action:** Start new preparation.
- **Secondary:** Search plans/sessions; Resume recent session; browse existing prep packages.
- **Next action:** Job Setup.

#### 2. Job Setup

- **Setup:** Paste URL or JD text, or pick existing job/application.
- **Derive:** Editable company and role; round selection.
- **Context shown:** Original + normalized JD preview in compact header.
- **Primary action:** Continue.
- **Next action:** Personalization.

#### 3. Personalization

- **Choices:** Resume version, STAR stories, knowledge sources, prep intensity, technical/coding settings.
- **Transparency:** "Intervu will use" summary of selections.
- **Primary action:** Choose session mode.
- **Next action:** Mode Selection.

#### 4. Mode Selection

- **Learn:** Review/reveal suggested answers; no scoring.
- **Practice:** Answer, critique, retry; scored feedback.
- **Entitlement:** Show credits/BYOK state before CTA.
- **Shared output:** Generate or load one plan used by both session and prep package.
- **Primary action:** Start Learn or Start Practice.
- **Next action:** Learn loop or Practice loop.

#### 5. Learn loop

- Compact job header; **Question X of N** (dynamic count, never hard-coded).
- Reveal suggested answer; star question.
- **Actions:** Practice this question; I understand → next.
- No score.
- **Next action:** Next question, switch to Practice, or Summary.

#### 6. Practice loop

- Compact job header; **Question X of N**.
- Answer field with existing dictation; star question.
- **Primary action:** How did I do?
- **Feedback order (exact):** reaction + score label → one thing to improve → say it like this → encouragement.
- **Primary CTA:** Continue.
- **Secondary:** Retry, edit answer, save useful material to STAR / star question.
- **Next action:** Next question, retry, or Summary.

#### 7. Summary

- **Progress separate from performance.**
- **Learn summary:** Reviewed / revealed / practiced / starred / unreviewed counts. CTA: Practice reviewed questions.
- **Practice summary:** Completed / retried / skipped; critique overview; strongest responses; repeated themes; focus questions. CTA: Retry focus questions.
- **Other actions:** Open prep package, view starred, go to application, start same-context new session.

#### 8. Prep package (secondary)

- **Switch:** Session | Prep package — persistent within plan; opening package never resets active session.
- **Retains:** Match strategy, company recon, reverse questions, technical, coding, system design, sources, question library/favorites, export.
- **Legacy plans:** Initially open familiar prep package view with Start Learn/Practice actions; session-first for new plans.

---

### B) Resume

1. **Resumes Hub** — Create / Import / Tailor as one entry.
2. **Source choice** — Profile or existing resume, upload, or scratch (where supported).
3. **Editor** — Standard editing with optional job targeting from preserved context.
4. **Recommendations** — One recommendation at a time: before/after, rationale; Apply / Edit / Skip.
5. **Version complete** — Named version saved.
6. **Next actions** — Export, generate cover letter, track application, prepare for interview.

---

### C) Cover Letter

1. **Contextual entry** — From Job detail, Application workspace, or Resume complete (no sidebar item).
2. **Source/resume choice** — Pick resume version driving the letter.
3. **Optional job targeting** — Prefilled from preserved context when available.
4. **Length** — Existing length choice.
5. **Generate / edit / regenerate / copy** — Parent context never lost on regenerate.
6. **Save confirmation** — Shows source context (job, resume, version).
7. **Next actions** — Return to origin, mark applied, open posting, prepare for interview.

---

### D) Job Search

1. **Entry** — Find jobs sidebar or Home.
2. **Mode choice** — Match my resume vs Explore.
3. **Retained context** — Resume and filters persist across navigation.
4. **Results** — Match indicators plus ghost-job differentiation.
5. **Detail** — Full job context in compact header.
6. **Actions** — Save, track, tailor, open posting, mark applied, prepare.
7. **State confirmation** — Visible confirmation after save/track/tailor.
8. **Next action** — Recommend next incomplete lifecycle step with full context carried forward.

---

### E) Application Tracker

1. **Entry** — Applications sidebar or Home grouped/search.
2. **Add** — URL/JD paste or pick Intervu job; parse first, confirm.
3. **Application Workspace** — Job header, status, linked resume/letter, notes, interview history.
4. **Inline updates** — Status change and stage actions without leaving workspace.
5. **History / feedback** — Prior prep sessions and notes visible.
6. **Stage-based next actions** — e.g., Interviewing → Prepare with full context; Offer → follow-up templates.

---

### F) STAR Story Bank

1. **Entry** — Library → STAR Stories tab, or feedback handoff from Practice.
2. **Search + Add/Improve** — Find existing or start new.
3. **Input** — Rough notes or existing story; optional competency tag or current interview question.
4. **STAR editor** — Preserves original notes alongside structured fields.
5. **Feedback** — Completeness indicator; improved version highlights weakest section.
6. **Save confirmation** — Story ID available for attachment.
7. **Next actions** — Practice with story, attach to prep personalization, create another.
8. **Feedback-to-story handoff** — Practice "save useful material" pre-fills story editor with question context and draft content.

---

### G) Auth / Onboarding

1. **Contextual gate** — Before first generation, after setup is inspectable (see Auth Gate P0).
2. **Sign-in modal** — Email/password; preserve interrupted setup and attempted action.
3. **Post-sign-in** — Optional resume import or skip.
4. **First-goal choice** — Prepare / Find jobs / Build resume (or equivalent).
5. **Confirm** — Imported context and destination route.
6. **Resume** — Return to exact attempted action with setup intact.

**Google Sign-In** is not locked as an implementation requirement. It remains a future scope choice pending separate product approval and is explicitly excluded from locked requirements in this design.

---

## Auth gate (P0)

| Rule | Behavior |
|---|---|
| When to gate | Start actions that require generation, after setup is inspectable |
| Preserve on gate | Job setup, personalization, selected mode |
| Explain | Clear sign-in need before blocking |
| On success | Auto-resume attempted Start action |
| On cancel/failure | Return unchanged; no data loss |
| Post-identity | Resolve credit/BYOK entitlement; never clear setup |
| Surprise prevention | Show available credit/BYOK state before Start CTA |

Intervu allows setup exploration before auth; Himalayas exhausted free allowance at checkout before setup — Intervu differentiates by showing entitlement early while gating generation without wiping context.

## Migration and compatibility

| Legacy state | Behavior |
|---|---|
| Existing plans | Listed under Existing prep packages on landing |
| Existing plan open | Initially familiar Prep package view with Start Learn/Practice actions |
| Cached data | Preserve cached plans, favorites, generated sections |
| Quick-start | Natural-language company/role/round still enters Job Setup |
| Deep links | Open equivalent package section |
| New plans | Session-first default |
| Forced migration | None — no regeneration required |
| User preference | When legacy user intentionally starts session, remember Session preference for that plan |

New plans default session-first; legacy plans default package-first until user chooses session — no conflict because preference is per-plan.

## Evidence-driven refinements

Authenticated walkthrough 2026-07-12 observations applied to this design:

| Observation | Design response |
|---|---|
| Artifact had 6 questions despite docs saying 5 | Dynamic X of N; never hard-code question count |
| Auth hub: Create, Search, resumable artifact | Landing: Start + Search + Resume recent |
| Exhausted free allowance → Plus checkout before setup | Entitlement before Start; setup exploration allowed; gate without wiping |
| Summary: questions answered + performance + overall scores | Progress distinct from performance; clear scoring labels |
| Resume/cover: source choice then optional tailor-to-job | Standardize two-decision setup across Resume and Cover Letter |
| Mode picker / per-answer feedback not safely verified | Do not claim Himalayas UI details beyond observation |
| Himalayas job detail lacked AI handoffs | Intervu shared context is intentional differentiation |

## Priority order

| Priority | Scope | Rationale |
|---|---|---|
| **P0** | Shared context + interview loop + auth resumption | Biggest competitive gap; foundation for all handoffs |
| **P1** | Jobs → Resume → Application → Interview lifecycle; resume consolidation; application workspace | Differentiation and context continuity across tools |
| **P2** | Cover-letter journey; STAR feedback handoff; onboarding polish; completion/next-action consistency | Compounds P0/P1; polish and cross-flow coherence |

## Success criteria

Observable outcomes — no implementation detail:

1. Job Detail → first Practice question with no job re-entry.
2. Manual prep from one JD URL/paste with derived editable company/role.
3. Job, resume, and stories survive handoffs and return navigation.
4. Tailor from job requires no JD re-paste.
5. Cover letter from application knows job + resume without re-selection.
6. Auth returns user to exact attempted action.
7. Practice: one question → answer → feedback → retry or continue.
8. Progress visible throughout; no dead ends; one recommended next action at completion.
9. Back, refresh, and cancel-auth do not silently discard context.
10. **Usability:** ≥4 of 5 participants complete each core scenario without facilitator correction; identify primary action and current job within 5 seconds.
11. **Analytics measurement requirement:** Events can distinguish entry, setup complete, first action, feedback, completion, and next-action selection (measurement requirement only — not an analytics implementation spec).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Session-first hides deep prep | Persistent Prep package switch; legacy package default for existing plans |
| Shared context stale/incorrect | Editable job header; provenance fields; last-refreshed timestamp |
| Generated artifact mismatch after resume/JD update | Version IDs; explicit regenerate decision; never silently mutate |
| Auth/credit gate frustration | Entitlement before Start; preserved setup on gate |
| Scope expansion into Himalayas-only features | Explicit non-goals list |
| Migration confusion | No forced conversion; familiar legacy package; contextual prompts |
| Over-standardization erases Intervu personality | Retain copy, brand, components, ghost-job and prep differentiators |
| Summary scores misleading | Separate progress/performance; clear labels; no unexplained skipped-question penalty |

## Decision record

| Decision | Status |
|---|---|
| Scope C — all seven overlapping journeys | Locked |
| Flow parity, not visual clone; Intervu brand preserved | Locked |
| Session-first for new plans; prep package secondary | Locked |
| Package-first default for legacy plans until user chooses session | Locked |
| Shared job-context object across workflows | Locked |
| P0 → P1 → P2 priority order | Locked |
| Authenticated Himalayas walkthrough before design freeze | Locked |
| Dynamic X of N question count | Locked |
| Progress ≠ performance in summaries | Locked |
| Voice interviews, alerts, headshots, career coach | Out of scope |
| Google Sign-In | Excluded from locked requirements; future scope choice pending separate approval |

## Validation

**Methods:** Public Himalayas documentation; read-only authenticated walkthrough (2026-07-12).

**Safely observed:** Hub/nav pattern; 6-question interview artifact; 0/6 summary scoring; immediate Plus checkout on exhausted allowance; resume and cover two-step setup (source → optional job tailor).

**Could not safely verify:** Setup form fields, mode picker UI, per-answer feedback ordering — blocked by paywall and read-only constraints.

**Impact on this design:** Unknown Himalayas details do not block Intervu design. This spec relies on Intervu's existing capabilities (Learn/Practice, prep package, STAR bank, credits/BYOK) and observed flow principles — bounded sequential sessions, resumable artifacts, entitlement transparency — not cloning unverified hidden behavior.
