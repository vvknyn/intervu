/**
 * Single source of truth for the OpenClaw pitch copy, shared between the
 * landing hero (`src/app/page.tsx`), the condensed landing sections
 * (`LandingMarketing.tsx`), and the full story at `src/app/openclaw/page.tsx`.
 * All three read from these exports rather than each hand-copying the same
 * sentences — "condensed" placements slice/shorten these same arrays instead
 * of forking a second, drifting copy of the list.
 *
 * Stealth: no founder names or personal identity anywhere in this copy.
 * Product status (2026-08-02): the resume MCP tools (get_resume /
 * save_resume_variant / get_resume_variant) are live — this copy is not
 * waiting on those. The one still-unavailable piece is the OpenClaw skill
 * itself: merged into a private repo with no public home yet, and the
 * mcporter pairing path is untested. Every surface reading this module
 * should frame its ask around that one specific gap (never a vague "beta"
 * label — a generic badge on one unshipped piece reads like the whole
 * product is unshipped) and never "install now."
 */

export const OPENCLAW_HEADLINE =
  "While you slept, it found jobs, tailored your resume, and filled out the form. You just hit submit.";

export type ThreadRole = "agent" | "user";

export interface ThreadMessage {
  role: ThreadRole;
  text: string;
  /** Rendered as a small label above the bubble, not inline in the message
   *  text — only the first message carries one. */
  timestamp?: string;
  /** aria-label for a small attachment chip rendered after `text` — the
   *  "[screenshot]" beat from the product spec renders as a real chip, never
   *  literal bracket text. */
  attachment?: string;
  /** Optional second line in the same bubble, after the attachment chip. */
  followText?: string;
}

/**
 * The example WhatsApp exchange. Must render verbatim and identically
 * wherever it appears (landing hero, /openclaw) — `WhatsAppThreadHero`
 * renders this array directly rather than any surface re-typing the copy.
 */
export const WHATSAPP_THREAD: readonly ThreadMessage[] = [
  {
    role: "agent",
    text: "3 fit you today. 1 · Senior PM, Ramp — posted 6h ago · 2 · Product Lead, Vanta · 3 · Senior PM, Deel. Reply with a number.",
    timestamp: "8:10am",
  },
  { role: "user", text: "1" },
  {
    role: "agent",
    text: "Ramp wants payments infra + 0→1. You have both. Gap: they ask for public-company experience — you don't have it. Want me to prepare it?",
  },
  { role: "user", text: "yes" },
  {
    role: "agent",
    text: "Ready — resume tailored, 11 fields filled, resume attached.",
    attachment: "Attached: tailored resume PDF",
    followText: "Review and hit submit.",
  },
  { role: "user", text: "applied" },
  { role: "agent", text: "Logged. 4 of 20 today." },
];

export interface ContentStep {
  title: string;
  body: string;
}

/** "While you slept" — the ordered overnight sequence (a real sequence, so
 *  numbering is legitimate wherever this renders as an ordered list). */
export const WHILE_YOU_SLEPT_STEPS: readonly ContentStep[] = [
  { title: "Finds roles", body: "Scans the boards overnight for postings that fit your resume and target roles." },
  { title: "Tailors your resume", body: "Rewrites it to speak to that specific posting — same facts, sharper framing." },
  { title: "Fills the form", body: "Answers the application's questions and completes every field it asks for." },
  { title: "Attaches the PDF", body: "Exports the tailored resume and attaches it wherever the form expects a file." },
  { title: "Waits for you", body: "Stops at submit and sends the finished draft to WhatsApp for you to review." },
];

/** "What it won't do" — the differentiator vs. spray-and-pray auto-appliers,
 *  not a disclaimer list. */
export const WHAT_IT_WONT_DO_ITEMS: readonly ContentStep[] = [
  { title: "Never submits", body: "You always click submit — the agent stops the moment a form is ready to send." },
  { title: "Never invents experience", body: "It works with what's real on your resume, not what would look good." },
  { title: "Never answers EEO or demographic questions", body: "Those fields are left for you." },
  { title: "Stops at account walls", body: "If a posting needs a new login, it stops and hands the posting back to you." },
];

/** "Runs on your machine" — a single statement, not a list, so it isn't an
 *  array like the sections above; `short` is the landing condensed line,
 *  `long` is the /openclaw full paragraph. */
export const RUNS_ON_YOUR_MACHINE = {
  short: "Self-hosted. Your browser, your sessions, your data — free to self-host.",
  long: "OpenClaw runs entirely on your own machine — your browser, your sessions, your data. Nothing about how it browses or fills forms happens on someone else's server, and it's free to self-host.",
} as const;

export interface SetupStep extends ContentStep {
  /** Rendered in a copyable code block instead of prose, when present. */
  command?: string;
}

/** Setup in 3 steps — condensed (landing) shows titles only, full
 *  (/openclaw) shows title + body + the copyable command on step 2. */
export const SETUP_STEPS: readonly SetupStep[] = [
  { title: "Install OpenClaw", body: "The open-source assistant that runs on your own machine." },
  {
    title: "Authenticate",
    body: "Point it at intervu's data with your own key.",
    command: "mcporter auth https://intervu.cc/api/mcp",
  },
  { title: "Scan the WhatsApp QR", body: "Pair your WhatsApp so the agent can message you drafts to review." },
];
