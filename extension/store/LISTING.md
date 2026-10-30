# Chrome Web Store listing

Paste these into the item's tabs in the [developer dashboard](https://chrome.google.com/webstore/devconsole).
Every claim here is something the extension does today; keep it that way when either changes.
Name no other company's site or product in the description: Google rejected 0.3.1 ("Yellow Argon", excessive keywords) for listing job sites there.

## Package

Upload `extension/dist/velai-extension-<version>.zip` (`node extension/build.mjs --zip`). Version 0.3.x needs
velai.app to have `POST /api/extension/track` ("I applied") live first.

## Store listing tab

**Name** (from the manifest): Velai: check a job before you apply

**Summary** (from the manifest, 125 of 132 characters):
On job pages, see how the role fits your résumé and if the posting looks current, then fill the application from your résumé.

**Description:**

```
Velai checks the job you're looking at before you apply.

On the main job boards and applicant-tracking sites, a small Velai card shows up on job pages by itself (on a page that doesn't publish its job details, when the page reads as a job or Velai has the role). It gives your fit for the role and what's known about the posting: whether it looks actively posted, when it was posted, what it pays and the apply-by date. Every line says where it comes from, the page or Velai, and anything nobody knows is left out rather than guessed.

On company careers sites, turn the card on once from the welcome page or the panel, for every site or just one, and it shows there too. Chrome asks you first. Or click the Velai button on any page.

Your fit. Add your résumé on velai.app, free and with no account (it stays in your browser), and you get the same fit label velai.app gives, with its reasons: how closely the role matches your experience, its level against yours, and whether it's in your country. The card and panel show the words in the role's title that the fit counts, ticked when your résumé has them, and similar roles on Velai carry their own fit label.

Your résumé for this role. The panel proposes changes to your résumé for this job: lines reworded in the job's words, your summary, and the lines and skills the job asks for moved first. Each shows your own text beside the proposal and why, and you accept or reject it. Nothing changes until you accept it, and any rewording uses only words already in your résumé, so nothing is made up. Download your résumé with the changes you accepted as a one-page PDF, or copy the text. For bigger changes, edit your résumé on Velai in a small window; the job is checked again when you close it.

Fill the form. On a job's application form, "Fill from your résumé" fills in your name, email, phone, location and links from your résumé and attaches your résumé as a PDF with the changes you accepted for that job (as you wrote it if you accepted none). Fields that are already filled, drop-downs and check boxes stay yours. You check the form and send it yourself; the extension never sends one.

Answer the questions. Under a form's free-text questions ("Why are you interested in this role?", "Describe your experience with…"), "Draft an answer" writes a draft from the lines of your résumé that bear on that question. It never drafts the questions that are yours alone: work authorization, pay, demographics, start date, relocation, background checks, consents. A draft is marked as a draft from your résumé, says which résumé lines it comes from, and goes into the form only when you pick "Insert in the form". With a paid month on Velai, a sealed AI writes the draft from those lines. Check every claim before you send the form.

Track it (signed in to Velai). "Save" next to "I applied" puts the job in your Velai tracker's Saved column, without saying you applied. Once the site confirms an application the card filled, the job goes into your tracker as Applied. Applied some other way? Pick "I applied".

Signing in happens in a small window over the job page. It closes itself when you're done and the job is checked again, no second click.

You can also select a job title on any page, right-click and choose "Search Velai" to see matching roles from company careers pages.

How it treats your data
The card reads job pages only on the job sites it lists and on sites you turn it on for, and on those it checks each page inside your browser and tells Velai nothing about pages that aren't jobs. Anywhere else, the extension reads a page only when you click its button or choose "Search Velai". Without a paid month, your résumé is the one velai.app keeps in your browser: the extension reads it on velai.app's own pages and keeps the same copy in Chrome's storage on your computer, replaced or removed when you change or remove it on velai.app, and never sends it anywhere. With a paid month, your résumé comes from your Velai account, where it is saved encrypted, and the extension holds it in memory only, never in Chrome's storage. Your fit and the changes proposed to your résumé are worked out inside the extension, and your résumé with the changes you accepted stays in your browser until you download or copy it. For each job you reviewed, the extension remembers which proposed changes you accepted or rejected, as short codes with none of your résumé's text. Checking a job sends only its title and employer to Velai. When you fill a form, your contact details go from your résumé into that form inside your browser, and the site gets them only when you send it. When you pick "Draft an answer", the question, the job's title and employer and the few résumé lines that bear on the question, without your name, email, phone number or links, go to an AI model on a sealed server (Tinfoil's), which is part of a paid month: the extension first checks that server's hardware proof and encrypts the request to it, so Velai's servers pass it on without being able to read it. Without a paid month, or if sealed AI isn't available or can't be verified, nothing is sent and the draft is those résumé lines as they are. The extension keeps no copy of a draft. Signed in, it uses the velai.app sign-in in your browser and never sees your password.

Your fit, the résumé changes, form filling and the drafts need only your résumé on velai.app, free and with no account. The job checks need nothing. The tracker needs a Velai account, and a sealed AI writing the drafts needs a paid month.
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
Help the person apply to the job posting they are viewing, with Velai: how it fits their résumé, Velai's freshness and pay checks on the posting, changes to their résumé for it that they accept or reject one by one, filling its application form from that résumé on their click, drafting answers to the form's free-text questions from their résumé on their click, and adding it to their Velai tracker, as Saved when they save it or as Applied once they apply.

**Permission justifications:**
- Content script on velai.app (`velai-bridge.js`, on `https://velai.app/*` only, already covered by the host permission below): reads the one résumé velai.app keeps in that browser's storage for someone without a paid month and hands it to the extension, so their fit, résumé changes and form filling work without an account. It reads nothing else on the page and sends that résumé nowhere.
- Content script on the listed job sites (job boards and applicant-tracking sites; the full list is the manifest's `content_scripts`): when a page there loads, reads the job it publishes (its address, title and schema.org JobPosting details) and shows the Velai card. Pages that aren't jobs get nothing. It sends only the role's title and employer to Velai's search. On an application form, and only when the person clicks "Fill from your résumé", it types their name, email, phone, location and links from their résumé into the matching empty fields and attaches their résumé PDF with the changes they accepted; it never submits the form. Signed in, after a fill it reads that tab's pages for the site's "application sent" message, to add the job to their tracker.
- Optional host permission `https://*/*`: never granted at install. Asked for only when the person clicks "Show the Velai card on every careers site" (on the welcome page or in the side panel) or "only on <site>" (`https://<that site>/*`), so the card can show on company careers sites too. On those sites the card script checks each page locally (a JobPosting, or a heading plus an Apply button plus a job description's words) and sends nothing for pages that aren't jobs. Removable in Chrome's extension settings.
- `activeTab`: Reads the job on the tab where the person clicks the Velai button (its address, title, the schema.org JobPosting details it publishes, and its visible text only if they ask the panel to read the page as the job), once, at that moment.
- `scripting`: Runs the bundled page reader on the clicked tab, and registers the bundled card script for the sites the person turned the card on for. No code is fetched from anywhere.
- `sidePanel`: Shows the full report next to the job page.
- `contextMenus`: Adds "Search Velai for …" to the right-click menu for selected text.
- `storage`: Session storage hands the job from the background worker to the side panel, and remembers for two hours each tab's last job page and the job whose form was filled, so a form on a later page and its confirmation are tied to the right job (Chrome clears it when the browser closes). Local storage keeps the sites where the person turned the card off, a timestamp that tells the card to check again after they sign in or change their résumé, the copy of the résumé velai.app keeps in that browser for someone without a paid month (replaced or removed when velai.app's copy is), and, for each of their last 40 reviewed jobs for 60 days, which proposed résumé changes they accepted or rejected, as short codes with no résumé text, so the form fill attaches the same résumé the panel shows.
- Host permission `https://velai.app/*`: Calls Velai's own API with the person's existing velai.app sign-in, to load their saved résumé and job preferences, search Velai's jobs and add a job to their tracker; and opens velai.app's sign-in and résumé pages in a small window, which closes once they're signed in. It also asks velai.app whether sealed AI is on, and, when the person picks "Draft an answer", passes the sealed-AI request (encrypted to the attested server, so velai.app can't read it) through velai.app's pass-through, which adds Velai's key.
- Network requests to Tinfoil's and Sigstore's public attestation services (no host permission is needed or requested): before any sealed-AI request, the bundled verifier fetches the server's attestation documents (data, never code) to check it. No résumé content goes to them.

**Remote code:** No, I am not using remote code. (Everything runs from the package; the build bundles it.)

**Data usage**, tick:
- Personally identifiable information (the résumé, from the person's own Velai account or from velai.app's copy in their browser, holds their name and contact details; the lines of it that bear on a question the person asks for a draft of, without name or contact details, go encrypted to the sealed AI server)
- Website content (the job details read from job pages, and a form question the person asks for a draft of)

Then tick all three certifications (not sold to third parties; not used for purposes unrelated to the single purpose; not used for creditworthiness or lending).

**Privacy policy URL:** https://velai.app/privacy#browser-extension
