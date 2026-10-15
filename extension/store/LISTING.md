# Chrome Web Store listing

Paste these into the item's tabs in the [developer dashboard](https://chrome.google.com/webstore/devconsole).
Every claim here is something the extension does today; keep it that way when either changes.
Name no other company's site or product in the description: Google rejected 0.3.1 ("Yellow Argon", excessive keywords) for listing job sites there.

## Package

Upload `extension/dist/velai-extension-<version>.zip` (`node extension/build.mjs --zip`). Version 0.3.x needs
velai.app to have `POST /api/extension/track` ("I applied") live first.

## Store listing tab

**Name** (from the manifest): Velai: check a job before you apply

**Summary** (from the manifest, 131 of 132 characters):
On job pages, see how the role fits your Velai résumé and if the posting looks current, then fill the application from your résumé.

**Description:**

```
Velai checks the job you're looking at before you apply.

On the main job boards and applicant-tracking sites, a small Velai card shows up on job pages by itself (on a page that doesn't publish its job details, when the page reads as a job or Velai has the role). It gives your fit for the role and what's known about the posting: whether it looks actively posted, when it was posted, what it pays and the apply-by date. Every line says where it comes from, the page or Velai, and anything nobody knows is left out rather than guessed.

On company careers sites, turn the card on once from the welcome page or the panel, for every site or just one, and it shows there too. Chrome asks you first. Or click the Velai button on any page.

Your fit. Signed in to Velai with your résumé added, you get the same fit label velai.app gives, with its reasons: how closely the role matches your experience, its level against yours, and whether it's in your country. The card and panel show the words in the role's title that the fit counts, ticked when your résumé has them, and similar roles on Velai carry their own fit label.

Your résumé for this role. Your résumé with the lines and skills this job asks for moved first. Any rewording uses only words already in your résumé, so nothing is made up. Download it as a one-page PDF or copy the text. For bigger changes, edit your résumé on Velai in a small window; the job is checked again when you close it.

Fill the form. On a job's application form, "Fill from your résumé" fills in your name, email, phone, location and links from your Velai résumé and attaches your résumé tailored to the job as a PDF. Fields that are already filled, drop-downs, check boxes and questions stay yours. You check the form and send it yourself; the extension never sends one.

Track it. "Save" next to "I applied" puts the job in your Velai tracker's Saved column, without saying you applied. Once the site confirms an application the card filled, the job goes into your tracker as Applied. Applied some other way? Pick "I applied".

Signing in happens in a small window over the job page. It closes itself when you're done and the job is checked again, no second click.

You can also select a job title on any page, right-click and choose "Search Velai" to see matching roles from company careers pages.

How it treats your data
The card reads job pages only on the job sites it lists and on sites you turn it on for, and on those it checks each page inside your browser and tells Velai nothing about pages that aren't jobs. Anywhere else, the extension reads a page only when you click its button or choose "Search Velai". Your résumé comes from your Velai account, where it is saved encrypted, and the extension holds it in memory only, never in Chrome's storage. Your fit and tailored résumé are worked out inside the extension, and the tailored copy stays in your browser until you download or copy it. Checking a job sends only its title and employer to Velai. When you fill a form, your contact details go from your Velai account into that form inside your browser, and the site gets them only when you send it. It uses the velai.app sign-in in your browser and never sees your password.

You need a Velai account with a résumé on it for your fit and tailored résumé. The job checks work without signing in.
```

**Category:** Productivity › Tools
**Language:** English

**Graphic assets** (in `/mnt/project-files/chrome-listing/store-<version>/`):
- Store icon: `extension/icons/icon128.png` (`store-icon-128.png`)
- Screenshots (1280×800), in this order: `screenshot-1-fit-on-job-pages.png`, `screenshot-2-posting-checks.png`, `screenshot-3-why-it-fits.png`, `screenshot-4-tailored-resume.png`, `screenshot-5-fill-and-track.png`.
  Each is a headline and three points beside the real card or panel, made by `node extension/scripts/store-shots.mjs` from the screenshots `check-panel.mjs` saves. They show a made-up employer (Cedarbrook Health). Remove the old screenshots in the dashboard before adding these.
- Small promo tile (440×280): `promo-small-440x280.png`

**Official URL / Homepage:** https://velai.app
**Support URL:** https://velai.app/contact

## Privacy tab

**Single purpose:**
Help the person apply to the job posting they are viewing, with Velai: how it fits their Velai résumé, Velai's freshness and pay checks on the posting, their résumé tailored to it, filling its application form from that résumé on their click, and adding it to their Velai tracker, as Saved when they save it or as Applied once they apply.

**Permission justifications:**
- Content script on the listed job sites (job boards and applicant-tracking sites; the full list is the manifest's `content_scripts`): when a page there loads, reads the job it publishes (its address, title and schema.org JobPosting details) and shows the Velai card. Pages that aren't jobs get nothing. It sends only the role's title and employer to Velai's search. On an application form, and only when the person clicks "Fill from your résumé", it types their name, email, phone, location and links from their Velai résumé into the matching empty fields and attaches their tailored résumé PDF; it never submits the form. After a fill it reads that tab's pages for the site's "application sent" message, to add the job to their tracker.
- Optional host permission `https://*/*`: never granted at install. Asked for only when the person clicks "Show the Velai card on every careers site" (on the welcome page or in the side panel) or "only on <site>" (`https://<that site>/*`), so the card can show on company careers sites too. On those sites the card script checks each page locally (a JobPosting, or a heading plus an Apply button plus a job description's words) and sends nothing for pages that aren't jobs. Removable in Chrome's extension settings.
- `activeTab`: Reads the job on the tab where the person clicks the Velai button (its address, title, the schema.org JobPosting details it publishes, and its visible text only if they ask the panel to read the page as the job), once, at that moment.
- `scripting`: Runs the bundled page reader on the clicked tab, and registers the bundled card script for the sites the person turned the card on for. No code is fetched from anywhere.
- `sidePanel`: Shows the full report next to the job page.
- `contextMenus`: Adds "Search Velai for …" to the right-click menu for selected text.
- `storage`: Session storage hands the job from the background worker to the side panel, and remembers for two hours each tab's last job page and the job whose form was filled, so a form on a later page and its confirmation are tied to the right job (Chrome clears it when the browser closes). Local storage keeps the sites where the person turned the card off and a timestamp that tells the card to check again after they sign in.
- Host permission `https://velai.app/*`: Calls Velai's own API with the person's existing velai.app sign-in, to load their saved résumé and job preferences, search Velai's jobs and add a job to their tracker; and opens velai.app's sign-in and résumé pages in a small window, which closes once they're signed in.

**Remote code:** No, I am not using remote code. (Everything runs from the package; the build bundles it.)

**Data usage**, tick:
- Personally identifiable information (the résumé loaded from the person's own Velai account holds their name and contact details)
- Website content (the job details read from job pages)

Then tick all three certifications (not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending).

**Privacy policy URL:** https://velai.app/privacy#browser-extension
