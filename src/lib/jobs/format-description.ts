/**
 * Render-time formatter for job-description plaintext.
 *
 * intervu's jobs come from Subspace's Jobs API, where descriptions were
 * stripped of HTML at ingest. That frequently leaves a wall-of-text on ATS
 * pages whose HTML didn't use enough block-level tags (e.g. `workday_direct`
 * flattens "<p>…you</p>At MPC" → "youAt MPC", and "environment.Position
 * SummaryThis position" with no spaces or breaks), while other sources
 * (`lever_direct`, `ashby_direct`, `icims_direct`, `smartrecruiters_direct`)
 * store literal Markdown collapsed onto a single line (`## Heading **bold**
 * - item`). The detail pane has no Markdown renderer, so we reconstruct
 * structure heuristically here:
 *
 *  0. Normalize Markdown stored literally (`##`, `**`, `[t](u)`, collapsed
 *     `- ` bullets) — see normalizeMarkdown.
 *  1. Repair run-together patterns: "yearCentene" → "year Centene",
 *     "Purpose:Oversee" → "Purpose: Oversee", "required.5+" → "required.
 *     5+", "2026Job" → "2026 Job". The lowercase→uppercase split uses a 4+
 *     char-run gate + a compound-brand exclusion list to avoid breaking
 *     "iPhone" / "JavaScript" / "NetSuite"; the digit→uppercase split uses
 *     a 3+ digit-run gate so acronym-glued codes ("B2B", "S3", "401k",
 *     "401K") stay intact.
 *  2. Promote known-heading patterns ("Position Purpose:", "Pay Range:",
 *     "Responsibilities:") to a paragraph boundary so they render as <h4>.
 *  3. Split paragraphs on `\n\n+`. Paragraphs longer than PARA_SOFT_MAX are
 *     sentence-segmented into 2-3 sentence chunks so even a single mega-
 *     paragraph reads as scannable blocks instead of an unbroken wall.
 *  4. Detect bullet-like lines and group adjacent bullets into a <ul>.
 *
 * Ported verbatim from Subspace's lib/jobs-description-format.ts (the system
 * of record's render-time formatter) to keep intervu's job detail visually
 * consistent with Subspace's jobs portal. Pure (no React) — <JobDescription>
 * in app/jobs/page.tsx consumes the DescBlock[] it returns.
 */

const HEADING_KEYWORDS = new Set([
  "about the team", "about the role", "about us", "about the company",
  "your role", "what you'll do", "what you\u2019ll do", "what you will do", "what you'll be doing", "responsibilities",
  "qualifications", "requirements", "what we're looking for", "what we\u2019re looking for",
  "what we offer", "benefits", "compensation", "total compensation", "perks", "perks & benefits",
  "the role", "the team", "the company", "our values", "why join", "why join us",
  "minimum qualifications", "preferred qualifications", "nice to have",
  "your background", "your impact", "key responsibilities",
  "what success looks like", "who you are", "what you bring", "what you'll bring", "what you\u2019ll bring", "what you will bring",
  "additional information", "equal opportunity", "eeo statement",
  "position purpose", "education", "experience", "education/experience",
  "pay range", "salary", "salary range", "base salary", "compensation range",
  "essential functions", "essential duties", "duties", "skills",
  "required skills", "preferred skills", "technical skills",
  "physical requirements", "work environment", "schedule",
  "company description", "job description", "the opportunity",
  "what your impact will be", "role overview", "overview", "summary",
  "position summary", "job summary", "what will your job entail",
  "job type", "employment type", "vacancy status", "work location", "security clearance",
]);

// Common compound brand/product names that must not be split by the
// lowercase→uppercase repair. The regex below treats these as atomic.
const COMPOUND_BRANDS = [
  "JavaScript", "TypeScript", "NodeJS", "GitHub", "GitLab", "BitBucket",
  "PostgreSQL", "MongoDB", "MySQL", "MariaDB", "GraphQL", "OpenAI",
  "BigQuery", "DataDog", "CloudFlare", "DigitalOcean", "LinkedIn",
  "YouTube", "PayPal", "eBay", "iPhone", "iPad", "iPod", "iMac", "iOS",
  "macOS", "tvOS", "watchOS", "AppleScript", "WhatsApp", "WeChat",
  "AirBnB", "DoorDash", "TikTok", "OAuth", "WebGL", "WebSocket",
  "WebAssembly", "VSCode", "DevOps", "MLOps", "ChatGPT", "AnswerHub",
  "FactSet", "QuickBooks", "SharePoint", "OneDrive", "OneNote",
  "PowerPoint", "PowerShell", "DataBricks", "TensorFlow", "PyTorch",
  "ServiceNow", "DocuSign", "SalesForce", "Salesforce", "HubSpot",
  "MailChimp", "SendGrid", "Twilio", "Stripe", "Plaid", "OkCupid",
  "PostHog", "HelloFresh", "ChromeOS", "EdgeOS", "FreeBSD", "OpenBSD", "OpenJDK",
  "OpenSSL", "OpenAPI", "RESTful", "RxJS", "Vue", "ReactJS",
  "VueJS", "AngularJS", "NextJS", "NuxtJS", "Express", "FastAPI",
  "FullStack", "FrontEnd", "BackEnd", "DevSecOps", "NetSuite",
];

export interface DescBlock {
  type: "heading" | "para" | "list";
  text?: string;
  items?: string[];
  /** Bold lead-in for a `para` block whose text opens with a recognized
   *  short label glued to the rest of the paragraph ("Your role. We are
   *  looking for…") — see `extractBoldLead`. Renders as its own <strong>,
   *  distinct from a `heading` block: the label stays INLINE with the
   *  paragraph it introduces rather than being promoted to its own line. */
  lead?: string;
  /** Equal-opportunity / privacy / agency boilerplate: rendered smaller and
   *  muted, never dropped (see markFinePrint). */
  fine?: boolean;
}

const PARA_SOFT_MAX = 360; // Above this, sentence-group long paragraphs.
const SENTENCES_PER_CHUNK = 3;

export function repairRunTogethers(input: string): string {
  let text = input;
  // (a) Protect compound brand names by placeholdering. Placeholder uses
  // chars that can't appear in normal text (\x00 and \x01).
  const placeholders: { ph: string; original: string }[] = [];
  COMPOUND_BRANDS.forEach((b, i) => {
    if (text.includes(b)) {
      const ph = `\x00B${i}\x01`;
      placeholders.push({ ph, original: b });
      // Split/join is faster than a regex with escaped brand names.
      text = text.split(b).join(ph);
    }
  });
  // (b) Insert space at "wordWord" boundaries where the prior lowercase
  //     run is 4+ chars (avoids "iOS"/"GitHub"-style false positives) AND
  //     the next char is uppercase followed by lowercase.
  text = text.replace(/([a-z]{4,})([A-Z][a-z])/g, "$1 $2");
  // (b2) intervu addition over the Subspace port: split a glued *closed-
  //      class function word* + Capitalized word ("youAt" → "you At"). The
  //      4+ gate in (b) misses these (the word is ≤3 chars), yet they are
  //      common at flattened "<p>…you</p>At …" boundaries (the user-
  //      screenshotted MPC role led with "awaits youAt MPC"). Closed-class
  //      words are never brand prefixes, so this is false-positive-free on
  //      the live corpus (verified across every ATS source's sample).
  text = text.replace(
    /\b(you|your|our|its|the|and|for|are|with|this|that|from|into|will|who|why|how|out|but|not|has|was|can)([A-Z][a-z])/g,
    "$1 $2",
  );
  // (b3) Digit run + Capital boundary ("2026Job" → "2026 Job"): a 3+ digit
  //      run (years, dollar amounts, headcounts) glued directly to a
  //      Capital+lowercase word. Gated the same way as (b) — the run must
  //      be followed by an actual word (capital THEN lowercase), not just a
  //      trailing capital — so acronym-glued codes like "B2B", "S3", "401K"
  //      never match (nothing lowercase follows the capital in those), and
  //      "401k" doesn't match either (the char after the digits is already
  //      lowercase). The 3+ gate leaves short digit-letter codes like "3M"
  //      or "Q3" alone.
  text = text.replace(/(\d{3,})([A-Z][a-z])/g, "$1 $2");
  // (c) Punctuation + capital with no space → insert space.
  text = text.replace(/([.!?])([A-Z])/g, "$1 $2");
  // (d) Period + digit ONLY when the period follows a letter, not another
  //     digit — avoids breaking currency like "$148,000.00" while still
  //     fixing "required.5+ years".
  text = text.replace(/([a-z]\.)(\d)/g, "$1 $2");
  // (e) Colon + capital (e.g., "Purpose:Oversee all") → insert space.
  text = text.replace(/(:)([A-Z])/g, "$1 $2");
  // (f) Restore protected brands.
  for (const { ph, original } of placeholders) {
    text = text.split(ph).join(original);
  }
  return text;
}

const INLINE_COLON_LABELS =
  "Total Compensation|Compensation Range|Compensation|Pay Range|Salary Range|Base Salary|Salary|Vacancy Status|Job Type|Employment Type|Work Location|Location|Position Summary|Position Purpose|Role Overview|Job Summary|About the Role|About the Team|About Us|The Role|Your Role|Key Responsibilities|Responsibilities|Minimum Qualifications|Preferred Qualifications|Qualifications|Requirements|What You'?ll Do|What You\u2019ll Do|What You Will Do|What You'?ll Bring|What You\u2019ll Bring|What You Will Bring|What You Bring|What We Offer|Perks & Benefits|Benefits|Equal Opportunity|Schedule|Security Clearance|Clearance";

const INLINE_BARE_HEADINGS =
  "The Role|About the Role|About the Team|About Us|About the Company|Job Type|Position Summary|Role Overview|The Opportunity|What You'?ll Do|What You\u2019ll Do|What You Will Do|Key Responsibilities|Essential Functions|What You'?ll Bring|What You\u2019ll Bring|What You Will Bring|What You Bring|What We'?re Looking For|What We\u2019re Looking For|Minimum Qualifications|Preferred Qualifications|Required Skills|Preferred Skills|Nice to Have|What We Offer|Perks & Benefits|Why Join Us|Who You Are|Your Impact";

const INLINE_HEADING_BODY_OPENERS =
  "We|We're|We\u2019re|You|You'll|You\u2019ll|You're|You\u2019re|Our|The|This|As|In|At|For|To|Full|Part|Remote|Hybrid|Permanent|Contract|Own|Lead|Drive|Build|Design|Manage|Develop|Partner|Work|Support|Create|Deliver|Oversee|Ensure|Collaborate|Define|Execute|Must|Have|Bring|Bachelor|Master|Degree|Competitive|Comprehensive|[0-9]+\\+?";

function promoteHeadings(input: string): string {
  let text = input;
  // "Section Word:" + space + Capital/digit/$ → paragraph break before
  // the heading and after the colon. Triggers after start-of-string, sentence
  // punctuation, or a closing parenthesis/bracket (e.g., "(Hybrid - Ottawa) Total Compensation: CAD $140,000").
  text = text.replace(
    /(^|[.!?)\]]\s+)([A-Z][\w &/-]{2,40}):\s+([A-Z$0-9])/g,
    "$1\n\n$2:\n$3",
  );
  // Known section/metadata labels with a colon glued mid-line without preceding
  // sentence punctuation (e.g., "experience and qualifications Vacancy Status: This posting...").
  const inlineColonRe = new RegExp(
    `(?<=\\S)[ \\t]+((?:${INLINE_COLON_LABELS})):[ \\t]+(?=[A-Z$0-9])`,
    "g",
  );
  text = text.replace(inlineColonRe, "\n\n$1:\n");
  // Flattened "About <Company>" heading glued mid-line before "<Company> is/helps..."
  // or "We / Our / At" (e.g., "Product Manager About Anvil Anvil is a trusted partner...").
  text = text.replace(
    /(?:^|(?<=\S)[ \t]+)(About ([A-Z][\w&.'-]*(?:[ \t]+[A-Z][\w&.'-]*){0,2}))[ \t]+(?=\2\b|(?:We|Our|At)[ \t]+[A-Za-z])/g,
    "\n\n$1\n\n",
  );
  // Flattened Title-Case section headings without colons glued mid-line before
  // a clause opener (e.g., "...hiring for this role The Role We're looking for a Product Manager...").
  const inlineBareRe = new RegExp(
    `(?:^|(?<=\\n)|(?<=[.!?\\])]\\s)|(?<=[a-z0-9]\\s))(${INLINE_BARE_HEADINGS})[ \\t\\n]+(?=(?:${INLINE_HEADING_BODY_OPENERS})\\b)`,
    "g",
  );
  text = text.replace(inlineBareRe, "\n\n$1\n\n");
  // ALL-CAPS section heading glued directly to its Titlecase body, no
  // colon and no space ("ABOUT GREYSTARGreystar is...", "JOB DESCRIPTION
  // SUMMARYThis role manages..." — observed live, sources that flatten
  // HTML block edges with zero separator).
  text = text.replace(
    /(^|[.!?]\s+)([A-Z][A-Z\s&/-]{2,58}[A-Z])(?=[A-Z][a-z])/g,
    "$1\n\n$2\n\n",
  );
  return text;
}

function sentenceGroup(paragraph: string): string[] {
  if (paragraph.length <= PARA_SOFT_MAX) return [paragraph];
  const sentences = paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= SENTENCES_PER_CHUNK) return [paragraph];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += SENTENCES_PER_CHUNK) {
    out.push(sentences.slice(i, i + SENTENCES_PER_CHUNK).join(" "));
  }
  return out;
}

/**
 * Normalize Markdown syntax that some ATS sources store literally. Without
 * this the detail pane renders raw `## Company Description **CREATIVITY IS
 * OUR SUPERPOWER.**` and concatenated `## Job Description ...` blocks run
 * together as one wall. The source strips HTML at ingest but leaves Markdown
 * intact; we render plain text + heuristic blocks (no inline-markup
 * renderer), so: strip emphasis/code/link markers to their text, and turn
 * ATX headings into hard paragraph breaks (dropping the `#`s) so the
 * considerHeading()/promoteHeadings() logic can still hoist a clean `##
 * Heading\n` line to <h4> while a run-together `## Heading body...` line at
 * least becomes its own clean paragraph.
 */
export function normalizeMarkdown(input: string): string {
  let text = input;
  // Fenced/inline code markers → keep the code text, drop the backticks.
  text = text.replace(/```+/g, "").replace(/`([^`\n]+)`/g, "$1");
  // Links / images: [label](url) and ![alt](url) → label/alt; <http…> → url.
  text = text.replace(/!?\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1");
  text = text.replace(/<(https?:\/\/[^>\s]+)>/g, "$1");
  // An ATX heading whose text is either bold-delimited (`# **About Zip**`)
  // or newline-terminated (`# Heading\nBody`) has a KNOWABLE end, unlike a
  // truly run-together `## Heading body…` line where "heading" stops and
  // "body" starts is ambiguous. Both knowable-end shapes are rewritten HERE
  // — before the generic bold-stripping a few lines down would destroy the
  // `**` boundary this depends on — into an isolated `\n\ntext:\n\n` block.
  const isolateHeading = (heading: string) => `\n\n${heading.trim().replace(/:+$/, "")}:\n\n`;
  text = text.replace(
    /(?:^|[ \t]*\n|[ \t]+)#{1,6}[ \t]+\*\*([^*\n]{1,88})\*\*/g,
    (_match, heading: string) => isolateHeading(heading),
  );
  text = text.replace(
    /(?:^|[ \t]*\n|[ \t]+)#{1,6}[ \t]+([^\n]{1,88})\n/g,
    (_match, heading: string) => isolateHeading(heading),
  );
  // Bold/italic (paired, non-greedy, single-line) → inner text.
  text = text.replace(/\*\*([^\n*]+?)\*\*/g, "$1");
  text = text.replace(/__([^\n_]+?)__/g, "$1");
  text = text.replace(/(^|[\s(])\*([^\n*]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2");
  text = text.replace(/(^|[\s(])_([^\n_]+?)_(?=[\s).,;:!?]|$)/g, "$1$2");
  // Any leftover stray emphasis runs.
  text = text.replace(/\*{2,}/g, "").replace(/_{3,}/g, "");
  // A lone "*" left glued to the front of a word: the unmatched half of a
  // mismatched run.
  text = text.replace(/(^|[\s(])\*(?=[A-Za-z0-9$])/gm, "$1");
  // ATX headings (#, ##, …) anywhere → hard paragraph break, drop the #s.
  text = text.replace(/(?:^|[ \t]*\n|[ \t]+)#{1,6}[ \t]+/g, "\n\n");
  // Blockquote markers at line start.
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  // Collapsed inline list bullets: stripHtml joins "<li>" items with a
  // bare " - " / " * " / " • ". Re-break them so the bullet grouper
  // (•-*· / N. prefix) picks them up. Protect parenthetical / work-mode
  // dashes like "Full Time (Remote Canada / Hybrid - Ottawa)" or "Monday - Friday"
  // so location/schedule qualifiers are never chopped into bogus bullets.
  text = text.replace(/[ \t]+[*•·][ \t]+(?=[A-Z(])/g, "\n- ");
  text = text.replace(
    /[ \t]+-[ \t]+(?=[A-Z(])/g,
    (match, offset: number, full: string) => {
      const before = full.slice(Math.max(0, offset - 32), offset);
      const after = full.slice(offset + match.length, offset + match.length + 60);
      // Inside parentheses: an unclosed ")" appears before any "(" on the same line.
      if (/^[^()\n]*\)/.test(after)) return match;
      // Work-mode, employment-type, or day-of-week dash compound ("Hybrid - Ottawa", "Monday - Friday").
      if (
        /\b(?:Hybrid|Remote|Onsite|On-site|In-person|Full[- ]Time|Part[- ]Time|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*$/i.test(
          before,
        )
      ) {
        return match;
      }
      return "\n- ";
    },
  );
  // Normalize leading "* " / "+ " bullets to "- " (matches bullet regex).
  text = text.replace(/^[ \t]*[*+][ \t]+/gm, "- ");
  return text;
}

/**
 * Defensive residual-HTML stripper. Subspace strips HTML at ingest (see the
 * module doc above — `PublicJob.description` is a plain-text field), so this
 * is belt-and-suspenders against whatever occasionally leaks through rather
 * than the primary sanitization boundary: <script>/<style> ELEMENTS
 * (tag + their content — a leaked script body is never real job-description
 * prose) are dropped entirely, then any remaining tag-shaped markup is
 * stripped down to its inner text, attributes and all. Gated on an actual
 * tag shape (`<` immediately followed by a letter, optionally `/`) so stray
 * comparison operators in real prose ("filed <3 tickets/week", "a<b") are
 * left alone — those never have a letter immediately after the `<`.
 */
export function stripResidualHtml(input: string): string {
  return input
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

/**
 * Splits a short, recognized label glued to the front of a paragraph
 * ("Your role. We are looking for…", "Requirements. 5+ years…") into a bold
 * lead + the rest of the prose, for DescBlock's `lead` field. Distinct from
 * `promoteHeadings` above: that function promotes a COLON-terminated label
 * ("Purpose:") to its own heading + paragraph pair; this handles a
 * PERIOD-terminated label that stays inline with the sentence it introduces
 * (promoting a 2-3 word label to a whole heading line reads as noise there).
 *
 * Reuses `HEADING_KEYWORDS` — the same recognized-label vocabulary
 * `considerHeading` already gates whole-line headings on — as the "is this
 * actually a label" test, rather than a second parallel keyword list: any
 * paragraph opening with one of those phrases, followed by ". " and 15+ more
 * characters of prose, qualifies. Ordinary sentences that happen to start
 * with a short capitalized phrase + period ("She left. The next day…") are
 * not in that vocabulary, so they fall through unchanged.
 */
const BOLD_LEAD_RE = /^([A-Za-z][\w '&/-]{1,38})\.\s+(?=[A-Z0-9$])(.{15,})$/;

export function extractBoldLead(text: string): { lead: string; rest: string } | null {
  const m = text.match(BOLD_LEAD_RE);
  if (!m) return null;
  const [, phrase, rest] = m as unknown as [string, string, string];
  if (!HEADING_KEYWORDS.has(phrase.toLowerCase().trim())) return null;
  return { lead: `${phrase}.`, rest };
}

/**
 * Every repair above, in order: the text a description's segments are cut
 * from. Nothing after this point changes a word — segmenting, labelling and
 * block-building only decide where the breaks go and what kind each piece is.
 */
function prepareDescriptionText(raw: string): string {
  let text = raw.replace(/\r\n?/g, "\n");
  text = stripResidualHtml(text);
  // Greenhouse/Workday HTML→text often leaves whitespace-only "blank" lines
  // (`\n \n`). Those are NOT `\n\n`, so later paragraph splits glue a
  // heading onto the next body line ("The role HelloFresh's…") and the
  // For-you template collapses a full JD into a thin soft-fail snippet.
  text = text.replace(/\n[ \t]+\n/g, "\n\n");
  text = normalizeMarkdown(text);
  text = repairRunTogethers(text);
  text = promoteHeadings(text);
  return text.replace(/\n{3,}/g, "\n\n");
}

/**
 * One line of a prepared description: the unit the rules below and the
 * on-device model (lib/local-ai/label-description.ts) both label. `text` is
 * the source line with only its bullet marker removed.
 */
export interface DescSegment {
  text: string;
  /** The source line carried an explicit bullet marker (•, -, *, ·, "1."). */
  marker: boolean;
  /** First line of its block: the start, or a blank line, precedes it. */
  breakBefore: boolean;
}

/**
 * H heading · B bullet item · P starts a paragraph · C continues the block
 * the line before it opened (a wrapped line of the same paragraph, heading
 * or item).
 */
export type SegmentLabel = "H" | "B" | "P" | "C";

export interface SegmentLabelling {
  labels: SegmentLabel[];
  /** False where the label is a guess the model may overrule: a standalone
   *  one-line block whose kind the source's markup no longer says. */
  sure: boolean[];
}

const BULLET_RE = /^([•\-*·]|\d+[.)])\s+/;

export function segmentDescription(raw: string | null | undefined): DescSegment[] {
  if (!raw) return [];
  const segments: DescSegment[] = [];
  for (const para of prepareDescriptionText(raw).split(/\n{2,}/)) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      const marker = BULLET_RE.test(line);
      segments.push({ text: marker ? line.replace(BULLET_RE, "") : line, marker, breakBefore: i === 0 });
    });
  }
  return segments;
}

function considerHeading(line: string): string | null {
  if (line.length > 90) return null;
  const lower = line.toLowerCase().replace(/[:.!?]+$/, "").trim();
  if (line.endsWith(":")) return line.replace(/:$/, "");
  if (HEADING_KEYWORDS.has(lower)) return line.replace(/:$/, "");
  // "About <Company>" section header (1-3 capitalized words after About).
  if (/^About [A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2}$/.test(line.trim())) return line.trim();
  // "ALL-CAPS SECTION" pattern.
  if (/^[A-Z][A-Z\s&/-]{3,89}$/.test(line)) return line;
  return null;
}

/** A short title-shaped line with no sentence punctuation: "What you should
 *  bring with you", "Who are you?". Only ever asked of a standalone line. */
function headingLike(text: string): boolean {
  const words = text.split(/\s+/).length;
  // One bare word ("Remote", "Full-time") is metadata; one-word section
  // titles are already in HEADING_KEYWORDS.
  if (text.length > 70 || words < 2 || words > 10) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (/[.,;:!]$/.test(text) || /[,;()/]/.test(text)) return false;
  if (/^(?:full[- ]time|part[- ]time|contract|permanent|temporary|internship)\b/i.test(text)) return false;
  // "Location: Remote", "Salary: $90k" are label + value facts, not titles.
  if (/:\s*\S/.test(text)) return false;
  return /[a-z]/i.test(text);
}

function sentenceCount(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}

/** Short enough to be one item of a list whose markers ingest dropped. */
function itemSized(text: string): boolean {
  return text.length <= 260 && sentenceCount(text) <= 2;
}

const bare = (text: string) => !/[.!?]$/.test(text);

// A sentence with its own subject ("We are…", "Our engineers…", "Expel is…")
// reads as prose; list items open on a verb or noun phrase.
const PROSE_START_RE =
  /^((We|We're|We’re|We've|We’ve|Our|You|You're|You’re|You'll|You’ll|Your|The|This|These|Those|That|It|It's|It’s|Its|They|Their|If|When|While|At|In|As|Here|There|For)(?=\s)|[A-Z][\w&'’.-]*( [A-Z][\w&'’.-]*)? (is|are|was|has|have|offers|provides|builds|helps)\s)/;

function proseLike(text: string): boolean {
  return !bare(text) && PROSE_START_RE.test(text);
}

/**
 * The rules' labels. Pass one keeps everything the source's own markup still
 * says (explicit bullets, "Heading:" lines, lines of one block). Pass two
 * reads runs of standalone one-line blocks — what an ATS page's `<li>` and
 * `<p><strong>` become once ingest turns every block tag into a blank line
 * (subspace job-enricher stripHtml) — as headings and lists.
 */
export function labelSegments(segments: DescSegment[]): SegmentLabelling {
  const n = segments.length;
  const labels: SegmentLabel[] = new Array(n).fill("P");
  const sure: boolean[] = new Array(n).fill(true);
  const singleLine = (i: number) => segments[i]!.breakBefore && (i + 1 === n || segments[i + 1]!.breakBefore);

  for (let i = 0; i < n; i++) {
    const seg = segments[i]!;
    if (seg.marker) labels[i] = "B";
    else if (seg.breakBefore && singleLine(i) && considerHeading(seg.text)) labels[i] = "H";
    // "Responsibilities:" on the first line of a block (promoteHeadings and
    // `<p><b>Label:</b><br>…` both leave one) titles the lines under it.
    else if (seg.breakBefore && seg.text.endsWith(":") && considerHeading(seg.text)) labels[i] = "H";
    else if (!seg.breakBefore && i > 0 && !segments[i - 1]!.marker && labels[i - 1] !== "H") labels[i] = "C";
  }

  // `<br>`-separated lines inside one block: when every line opens a new
  // capitalised phrase and most carry no full stop, they are items, not a
  // hard-wrapped paragraph (whose next line starts lower-case).
  for (let i = 0; i < n; i++) {
    if (labels[i] !== "P" || i + 1 >= n || labels[i + 1] !== "C") continue;
    let end = i + 1;
    while (end < n && labels[end] === "C") end++;
    const lines = segments.slice(i, end).map((s) => s.text);
    const items =
      lines.every(itemSized) &&
      lines.slice(1).every((l) => /^[A-Z0-9(“"$]/.test(l)) &&
      lines.filter(bare).length / lines.length >= 0.5;
    if (items) {
      for (let j = i; j < end; j++) {
        labels[j] = "B";
        sure[j] = false;
      }
    }
    i = end - 1;
  }

  // A multi-line prose run that is short and punctuation-free reads as one
  // heading ("What Your Impact Will Be:" above collapsed bullets).
  for (let i = 0; i < n; i++) {
    if (labels[i] !== "P") continue;
    let end = i + 1;
    while (end < n && labels[end] === "C") end++;
    const joined = segments.slice(i, end).map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    if (considerHeading(joined) && !/[.!?]\s/.test(joined)) labels[i] = "H";
  }

  const standalone = (i: number) => labels[i] === "P" && singleLine(i) && !segments[i]!.marker;
  for (let i = 0; i < n; ) {
    if (!standalone(i)) {
      i++;
      continue;
    }
    let end = i;
    while (end < n && standalone(end)) end++;
    for (let j = i; j < end; j++) sure[j] = false;
    labelStandaloneRun(segments, labels, i, end);
    i = end;
  }
  return { labels, sure };
}

function labelStandaloneRun(segments: DescSegment[], labels: SegmentLabel[], start: number, end: number): void {
  const hl = segments.slice(start, end).map((s) => headingLike(s.text));
  // A lone title-shaped line with something after it is a heading; two or
  // more in a row are short items ("Python", "SQL", "AWS").
  for (let j = start; j < end; j++) {
    const k = j - start;
    if (!hl[k]) continue;
    const alone = !(hl[k - 1] ?? false) && !(hl[k + 1] ?? false);
    if (alone && j + 1 < segments.length) labels[j] = "H";
  }
  // Boilerplate and "#LI-Remote" tags never join a list; they split the run.
  const breaker = (j: number) => labels[j] === "H" || isBoilerplate(segments[j]!.text);
  for (let j = start; j < end; ) {
    if (breaker(j)) {
      j++;
      continue;
    }
    let stop = j;
    while (stop < end && !breaker(stop)) stop++;
    const items = segments.slice(j, stop).map((s) => s.text);
    if (itemRun(items, j > 0 && labels[j - 1] === "H")) {
      // A closing "We hire across Canada." under a bare skills list stays prose.
      let first = j;
      let last = stop - 1;
      while (first < last && proseLike(segments[first]!.text)) first++;
      while (last > first && proseLike(segments[last]!.text)) last--;
      for (let m = first; m <= last; m++) labels[m] = "B";
    }
    j = stop;
  }
}

function isBoilerplate(text: string): boolean {
  return HASHTAGS_RE.test(text) || (LEGAL_PARA_RE.test(text) && !MONEY_RE.test(text));
}

function itemRun(items: string[], afterHeading: boolean): boolean {
  if (!items.every(itemSized)) return false;
  const bareShare = items.filter(bare).length / items.length;
  if (bareShare >= 0.5) return items.length >= (afterHeading ? 2 : 3);
  // Punctuated all the way through: a list only when the lines don't read
  // as prose with their own subjects, so "About us" paragraphs stay prose.
  if (items.filter(proseLike).length / items.length >= 0.5) return false;
  const avg = items.reduce((sum, t) => sum + t.length, 0) / items.length;
  return items.length >= 3 && avg <= (afterHeading ? 160 : 100);
}

const LEGAL_HEADING_RE = /equal (employment )?opportunit|\beeo\b|accommodation|privacy|disclaimer|e-verify|legal notice|notice to (applicants|candidates|recruiters|agencies)|recruitment (fraud|scam)|commitment to (diversity|equal|inclusion)/i;
const LEGAL_PARA_RE = /\b(equal (employment )?opportunity|without regard to|regardless of (race|age|gender|sex)|protected (veteran|characteristic|class|status)|reasonable accommodations?|e-verify|affirmative action|fair chance|arrest (and|or) conviction|unsolicited (resumes|résumés|candidates)|recruitment agenc|privacy (notice|policy))/i;
const HASHTAGS_RE = /^(#[\w-]+[\s,]*)+$/;
/** Pay and money are facts people decide on: never shown as fine print. */
const MONEY_RE = /[$€£¥₹]\s?\d|\d\s?(USD|CAD|EUR|GBP|k\b)|\b(salary|base pay|pay range|compensation|hourly|per hour|OTE|bonus|equity|stock)\b/i;

function blockText(block: DescBlock): string {
  return block.type === "list" ? (block.items ?? []).join(" ") : `${block.lead ?? ""} ${block.text ?? ""}`;
}

/** Equal-opportunity, privacy and agency boilerplate, and trailing "#LI-…"
 *  tags, read as fine print: same words, less weight. */
function markFinePrint(blocks: DescBlock[]): DescBlock[] {
  let legal = false;
  for (const block of blocks) {
    if (block.type === "heading") {
      legal = LEGAL_HEADING_RE.test(block.text ?? "");
      if (legal) block.fine = true;
      continue;
    }
    const text = blockText(block);
    if (MONEY_RE.test(text)) continue;
    if (legal || HASHTAGS_RE.test(text.trim()) || (block.type === "para" && LEGAL_PARA_RE.test(text))) block.fine = true;
  }
  return blocks;
}

/**
 * "Location: Toronto (Hybrid)", "Schedule: Monday to Friday" — a short
 * label + value line keeps its words and gets its label in bold, the same
 * `lead` a "Your role." opener gets.
 */
export function extractColonLead(text: string): { lead: string; rest: string } | null {
  const m = text.match(/^([A-Z][^:.!?\n]{1,32}):\s+(\S.*)$/);
  if (!m || m[1]!.split(/\s+/).length > 4) return null;
  return { lead: `${m[1]}:`, rest: m[2]! };
}

export function buildDescriptionBlocks(segments: DescSegment[], labels: SegmentLabel[]): DescBlock[] {
  const blocks: DescBlock[] = [];
  let list: string[] = [];
  let open: { kind: "heading" | "para"; parts: string[] } | null = null;

  const flushList = () => {
    if (list.length) blocks.push({ type: "list", items: list });
    list = [];
  };
  const flushOpen = () => {
    if (!open) return;
    const joined = open.parts.join(" ").replace(/\s+/g, " ").trim();
    const kind = open.kind;
    open = null;
    if (!joined) return;
    if (kind === "heading") {
      blocks.push({ type: "heading", text: joined.replace(/:$/, "") });
      return;
    }
    sentenceGroup(joined).forEach((chunk, i) => {
      // Only the FIRST chunk of a paragraph can carry its original lead —
      // later chunks are sentence-grouped continuations of the same
      // paragraph, not new paragraph openings.
      const split = i === 0 ? (extractBoldLead(chunk) ?? extractColonLead(chunk)) : null;
      blocks.push(split ? { type: "para", text: split.rest, lead: split.lead } : { type: "para", text: chunk });
    });
  };

  segments.forEach((seg, i) => {
    const label = labels[i] ?? "P";
    if (label === "C" && open) {
      open.parts.push(seg.text);
    } else if (label === "C" && list.length) {
      list[list.length - 1] = `${list[list.length - 1]} ${seg.text}`;
    } else if (label === "B") {
      flushOpen();
      list.push(seg.text);
    } else {
      flushOpen();
      flushList();
      open = { kind: label === "H" ? "heading" : "para", parts: [seg.text] };
    }
  });
  flushOpen();
  flushList();
  return markFinePrint(blocks);
}

export function formatDescription(raw: string | null | undefined): DescBlock[] {
  const segments = segmentDescription(raw);
  return buildDescriptionBlocks(segments, labelSegments(segments).labels);
}
