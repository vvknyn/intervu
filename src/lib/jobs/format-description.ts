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
  "what you'll do", "what you'll be doing", "responsibilities",
  "qualifications", "requirements", "what we're looking for",
  "what we offer", "benefits", "compensation", "perks",
  "the role", "the team", "the company", "our values", "why join",
  "minimum qualifications", "preferred qualifications", "nice to have",
  "your background", "your impact", "key responsibilities",
  "what success looks like", "who you are", "what you bring",
  "additional information", "equal opportunity", "eeo statement",
  "position purpose", "education", "experience", "education/experience",
  "pay range", "salary", "salary range", "compensation range",
  "essential functions", "essential duties", "duties", "skills",
  "required skills", "preferred skills", "technical skills",
  "physical requirements", "work environment", "schedule",
  "company description", "job description", "the opportunity",
  "what your impact will be", "role overview", "overview", "summary",
  "position summary", "what will your job entail",
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
  "PostHog", "ChromeOS", "EdgeOS", "FreeBSD", "OpenBSD", "OpenJDK",
  "OpenSSL", "OpenAPI", "RESTful", "RxJS", "Vue", "ReactJS",
  "VueJS", "AngularJS", "NextJS", "NuxtJS", "Express", "FastAPI",
  "FullStack", "FrontEnd", "BackEnd", "DevSecOps", "NetSuite",
];

export interface DescBlock {
  type: "heading" | "para" | "list";
  text?: string;
  items?: string[];
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

function promoteHeadings(input: string): string {
  // "Section Word:" + space + Capital/digit/$ → paragraph break before
  // the heading and after the colon. Only triggers for noun-phrase-
  // shaped headings (≤40 chars, mostly letters/spaces/slash/dash). The
  // third capture allows $ and digit so "Pay Range: $148,000" promotes.
  return input.replace(
    /(^|[.!?]\s+)([A-Z][\w &/-]{2,40}):\s+([A-Z$0-9])/g,
    "$1\n\n$2:\n$3",
  );
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
  // Bold/italic (paired, non-greedy, single-line) → inner text.
  text = text.replace(/\*\*([^\n*]+?)\*\*/g, "$1");
  text = text.replace(/__([^\n_]+?)__/g, "$1");
  text = text.replace(/(^|[\s(])\*([^\n*]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2");
  text = text.replace(/(^|[\s(])_([^\n_]+?)_(?=[\s).,;:!?]|$)/g, "$1$2");
  // Any leftover stray emphasis runs.
  text = text.replace(/\*{2,}/g, "").replace(/_{3,}/g, "");
  // ATX headings (#, ##, …) anywhere → hard paragraph break, drop the #s.
  // Keeps the heading text on its own logical line so a clean newline-
  // terminated heading still reaches considerHeading(); a run-together
  // heading just becomes a clean broken paragraph (no raw `#`).
  text = text.replace(/(?:^|[ \t]*\n|[ \t]+)#{1,6}[ \t]+/g, "\n\n");
  // Blockquote markers at line start.
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  // Collapsed inline list bullets: stripHtml joins "<li>" items with a
  // bare " - " / " * " / " • ". Re-break them so the bullet grouper
  // (•-*· / N. prefix) picks them up. Conservative: only when the marker
  // is space-delimited and the item starts with a capital or "(".
  text = text.replace(/[ \t]+[-*•][ \t]+(?=[A-Z(])/g, "\n- ");
  // Normalize leading "* " / "+ " bullets to "- " (matches bullet regex).
  text = text.replace(/^[ \t]*[*+][ \t]+/gm, "- ");
  return text;
}

export function formatDescription(raw: string | null | undefined): DescBlock[] {
  if (!raw) return [];
  let text = raw.replace(/\r\n?/g, "\n");

  text = normalizeMarkdown(text);
  text = repairRunTogethers(text);
  text = promoteHeadings(text);
  text = text.replace(/\n{3,}/g, "\n\n");

  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const blocks: DescBlock[] = [];
  let listBuffer: string[] = [];
  const flushList = () => {
    if (listBuffer.length) {
      blocks.push({ type: "list", items: listBuffer.slice() });
      listBuffer = [];
    }
  };

  const considerHeading = (line: string): string | null => {
    if (line.length > 90) return null;
    const lower = line.toLowerCase().replace(/[:.!?]+$/, "").trim();
    if (line.endsWith(":")) return line.replace(/:$/, "");
    if (HEADING_KEYWORDS.has(lower)) return line.replace(/:$/, "");
    // "ALL-CAPS SECTION" pattern.
    if (/^[A-Z][A-Z\s&/-]{3,89}$/.test(line)) return line;
    return null;
  };

  const isBullet = (l: string) => /^([•\-*·]|\d+[.)])\s+/.test(l);
  const stripBullet = (l: string) => l.replace(/^([•\-*·]|\d+[.)])\s+/, "");

  let proseBuf: string[] = [];
  const flushProse = () => {
    if (!proseBuf.length) return;
    const joined = proseBuf.join(" ").replace(/\s+/g, " ").trim();
    proseBuf = [];
    if (!joined) return;
    // A short, punctuation-free prose run may itself be a heading.
    const head = considerHeading(joined);
    if (head && !/[.!?]\s/.test(joined)) {
      blocks.push({ type: "heading", text: head });
      return;
    }
    for (const chunk of sentenceGroup(joined)) {
      blocks.push({ type: "para", text: chunk });
    }
  };

  for (const para of paragraphs) {
    const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);

    // Single-line non-bullet block — may be a heading.
    if (lines.length === 1 && !isBullet(lines[0]!)) {
      const head = considerHeading(lines[0]!);
      if (head) {
        flushProse();
        flushList();
        blocks.push({ type: "heading", text: head });
        continue;
      }
    }

    // Walk the paragraph line-by-line so a MIXED block — an intro/heading
    // line followed by collapsed bullets ("What Your Impact Will Be:\n-
    // Lead\n- Coordinate", common once Markdown is normalized) — splits
    // into prose + a real <ul>.
    for (const l of lines) {
      if (isBullet(l)) {
        flushProse();
        listBuffer.push(stripBullet(l));
      } else {
        flushList();
        proseBuf.push(l);
      }
    }
    flushProse();
  }
  flushProse();
  flushList();
  return blocks;
}
