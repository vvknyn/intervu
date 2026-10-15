# Velai Chrome extension

"Velai: check a job before you apply".

**The card.** On the job boards and applicant-tracking sites in `job-sites.json` (and any site the person turns it on for), a small card shows on job pages by itself: the person's fit label and up to four facts about the posting (Velai's status check, posted date, pay, apply-by date, the employer's other open roles), each naming where it comes from. Unknown facts are left out. A page that doesn't publish schema.org JobPosting details only gets a card when Velai has the role. Its buttons open the side panel, sign in, or add the job to the person's tracker: "Save" puts it in the Saved column without saying they applied, "I applied" in Applied.

**The side panel** (the card's button, or the toolbar button on any page):

1. **Your fit**: `scoreJobAgainstResume` against the résumé saved on the person's Velai account, labelled and explained exactly as velai.app does, plus the role's terms the résumé doesn't have (`relevanceTerms`, the same terms the label counts) and "Edit your résumé on Velai".
2. **Velai's checks**: Velai's status verdict, posted age and pay when Velai has the posting (matched by posting URL, or the same title at the same employer); otherwise only what the page itself states.
3. **Your résumé for this role**: the changes Velai proposes for this posting, the same draft as velai.app's "Customize résumé" and the MCP `tailor_resume` tool (`rulesTailorDraft`: lines reworded in the posting's words, the summary, the job's lines and skills first, a project to leave off; every rewording behind `groundDraft`, so no word or number the résumé doesn't already have). Each shows the person's own text beside the proposal, with the reason, and is applied only when they accept it (`src/tailor-review.ts`); Download PDF (one page, the site's renderer) and Copy text have the accepted changes and no others, so with none accepted they are the résumé as written. What was accepted or rejected is kept per job in `chrome.storage.local` (`velaiTailorChoices`, `src/tailor-choices.ts`) as `id#hash` marks with no résumé text, for the latest 40 jobs and 60 days; a mark is dropped when the résumé was saved again since, or when that change reads differently now. The card's "Fill from your résumé" attaches the PDF made from the same choices (`fillData`) and says how many of the proposed changes it carries.
4. **Applying**: "I applied" adds the job to the person's Velai tracker (`POST /api/extension/track`, the site's `markJobAppliedAction`); "Save" adds it as Saved without applying (`"stage": "saved"`, `markJobSavedAction`, the stage the site's Save bookmark and the MCP `save_job` write). A role already further along keeps its status, and the card says so.

5. **Answers** (the card, under an application form's free-text questions; `src/form-questions.ts` finds them, `src/lib/screening/` decides and drafts): each empty text area, or one-line box labelled as a question, is listed with "Draft an answer", or "Velai leaves this one to you: <reason>" for work authorization, demographics, pay, start date, relocation, background checks, consents, where they heard about the job, history with the employer and a cover letter (`classifyQuestion`). One tap, one request: `draftAnswer` in the service worker re-checks the question, picks up to four résumé lines that bear on it (`screeningEvidence`, name and contact details taken out) and, when `/api/sealed-ai/status` says sealed AI is on, asks the model through the same Tinfoil client the site uses (`sealedChat`, `useSealedAiOrigin`, pass-through `/api/sealed-ai/v1/chat/completions`, which accepts the extension's origin). The question, the job's title and employer and those lines are all that is sent; a question no line bears on is not drafted and nothing is sent. The reply is used only if it passes `acceptReply` (no contact details, no number, name or word the résumé lines, résumé and question don't have), else the draft is the lines themselves ("no AI"). The card marks it as a draft from the résumé, names the résumé lines, and writes into the form only on "Insert in the form", never over text already there; "Copy" and "Discard" leave the form alone. The MCP `draft_screening_answer` tool returns the same verdict, lines and rules draft (never calls sealed AI: the assistant is the model).

Selected text has a "Search Velai for …" menu item that lists matching roles.

## How it fits together

- `src/card.ts` (content script): reads the page with `readJobPage` and asks the service worker what to show; draws the card in a closed shadow root. Content scripts can't call velai.app (CORS), so the worker does.
- `src/background.ts` (service worker): answers the card (`cardSummary`, `src/card-summary.ts`) with one search per page, marked `automatic` so velai.app doesn't log it as a person's search; opens the panel; runs sign-in and the résumé editor in a small velai.app window that closes itself once `GET /api/extension/me` says signed in, then bumps `velaiAccountChangedAt` in local storage so the card and panel check again without a click; keeps the card's registered content script in step with the sites the person granted (optional host permissions, one site at a time).
- `src/sidepanel.ts`: calls `GET https://velai.app/api/extension/me` (résumé and preferences for the signed-in person; `src/app/api/extension/me/route.ts`) and `POST /api/jobs/search`, both with the velai.app session cookie (`credentials: "include"`; the host permission lets the cookie through).
- `src/welcome.ts`: the first-install page, which signs the person in right there.
- Everything is bundled by esbuild from the site's own `src/lib`; no code is loaded from the network (the store rejects remote code). The service worker includes the Tinfoil client (about 1.8 MB), whose attestation verifier fetches data from Tinfoil's and Sigstore's hosts; `zlib` is stubbed (`src/no-zlib.ts`) because Chrome has `DecompressionStream`.

## Build

```
node extension/build.mjs          # extension/dist/unpacked: load it at chrome://extensions (Developer mode → Load unpacked)
node extension/build.mjs --zip    # also extension/dist/velai-extension-<version>.zip for the store
```

`build.mjs` writes the card's `content_scripts` into the manifest from `job-sites.json`. Bump `version` in `manifest.json` before each store upload.
Unit tests: `tests/unit/extension-*.test.ts`. In Chromium against a stubbed velai.app (panel states, the card, sign-in, I applied):
`node extension/build.mjs && CHROMIUM_PATH=/opt/pw-browsers/chromium node extension/scripts/check-panel.mjs`.
The store copy, permission justifications and data disclosures are in `store/LISTING.md`.
