# Velai Chrome extension

"Velai: check a job before you apply". On a job page, the toolbar button opens a side panel with:

1. **Your fit**: `scoreJobAgainstResume` against the résumé saved on the person's Velai account, labelled and explained exactly as velai.app does.
2. **Velai's checks**: Velai's status verdict, posted age and pay when Velai has the posting (matched by posting URL, or the same title at the same employer); otherwise only what the page itself states.
3. **Your résumé for this role**: the site's heuristic tailor behind `groundDraft` (no word or number the résumé doesn't already have), then the job's lines and skills moved first (`src/tailor-order.ts`). Downloads as a one-page PDF with the site's renderer.

Selected text has a "Search Velai for …" menu item that lists matching roles.

## How it fits together

- `src/background.ts`: on a click (`activeTab`), injects `readJobPage` (`src/page-reader.ts`) into that tab, opens the panel and hands the read over in `chrome.storage.session`.
- `src/sidepanel.ts`: calls `GET https://velai.app/api/extension/me` (résumé and preferences for the signed-in person; `src/app/api/extension/me/route.ts`) and `POST /api/jobs/search`, both with the velai.app session cookie (`credentials: "include"`; the host permission lets the cookie through).
- A page without schema.org JobPosting details only gets a report when Velai has that role or the person picks "Read this page as the job", so a page that isn't a job never gets a fit label.
- Everything is bundled by esbuild from the site's own `src/lib`; nothing is loaded from the network (the store rejects remote code).

## Build

```
node extension/build.mjs          # extension/dist/unpacked: load it at chrome://extensions (Developer mode → Load unpacked)
node extension/build.mjs --zip    # also extension/dist/velai-extension-<version>.zip for the store
```

Bump `version` in `manifest.json` before each store upload. Unit tests: `tests/unit/extension-*.test.ts`.
The store copy, permission justifications and data disclosures are in `store/LISTING.md`.
