# Chrome Web Store listing

Paste these into the item's tabs in the [developer dashboard](https://chrome.google.com/webstore/devconsole).
Every claim here is something the extension does today; keep it that way when either changes.

## Package

Upload `extension/dist/velai-extension-<version>.zip` (`node extension/build.mjs --zip`).

## Store listing tab

**Name** (from the manifest): Velai: check a job before you apply

**Summary** (from the manifest, 124 of 132 characters):
On any job page, see how the role fits your Velai résumé, whether the posting looks current, and your résumé tailored to it.

**Description:**

```
Velai checks the job you're looking at before you apply.

Open a job on an employer's careers site or a job board and click the Velai button. A side panel opens next to the page with three things.

Your fit. Signed in to Velai with your résumé added, you get the same fit label velai.app gives, with its reasons: how closely the role matches your experience, its level against yours, and whether it's in your country.

Velai's checks. When Velai tracks the posting, you see whether it looks actively posted, when it was posted and what it pays. When Velai doesn't have it yet, the panel says so and shows only what the page itself states, such as an apply-by date.

Your résumé for this role. Your résumé with the lines and skills this job asks for moved first. Any rewording uses only words already in your résumé, so nothing is made up. Download it as a one-page PDF or copy the text.

You can also select a job title on any page, right-click and choose "Search Velai" to see matching roles from company careers pages.

How it treats your data
The extension reads a page only when you click its button or choose "Search Velai". Your fit and tailored résumé are worked out inside the extension, and the tailored copy stays in your browser until you download or copy it. It uses the velai.app sign-in already in your browser and never sees your password.

You need a Velai account with a résumé on it for your fit and tailored résumé. The job checks work without signing in.
```

**Category:** Productivity › Tools
**Language:** English

**Graphic assets** (in `/mnt/project-files/chrome-listing/store/`):
- Store icon: `extension/icons/icon128.png`
- Screenshots (1280×800): `screenshot-1-fit-and-checks.png`, `screenshot-2-tailored-resume.png`, `screenshot-3-search-selection.png`.
  They show a made-up employer and résumé (Cedarbrook Health, Jordan Lee) on the real panel; retake them on a live job any time.
- Small promo tile (440×280): `promo-small-440x280.png`

**Official URL / Homepage:** https://velai.app
**Support URL:** https://velai.app/contact

## Privacy tab

**Single purpose:**
Check a job posting the person is viewing against Velai: how it fits their Velai résumé, Velai's freshness and pay checks on the posting, and their résumé tailored to it.

**Permission justifications:**
- `activeTab`: Reads the job on the tab where the person clicks the Velai button (its address, title, the schema.org JobPosting details it publishes, and its visible text only if they ask the panel to read the page as the job), once, at that moment.
- `scripting`: Runs the one bundled function that reads those job details on the clicked tab. No code is fetched from anywhere.
- `sidePanel`: Shows the report next to the job page.
- `contextMenus`: Adds "Search Velai for …" to the right-click menu for selected text.
- `storage`: Hands the clicked page's job details from the background worker to the side panel, in session storage only, which Chrome clears when the browser closes.
- Host permission `https://velai.app/*`: Calls Velai's own API with the person's existing velai.app sign-in, to load their saved résumé and job preferences and to search Velai's jobs.

**Remote code:** No, I am not using remote code. (Everything runs from the package; the build bundles it.)

**Data usage**, tick:
- Personally identifiable information (the résumé loaded from the person's own Velai account holds their name and contact details)
- Website content (the job details read from the page they clicked on)

Then tick all three certifications (not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending).

**Privacy policy URL:** https://velai.app/privacy#browser-extension
