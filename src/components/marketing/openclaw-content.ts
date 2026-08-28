/**
 * Single source of truth for the OpenClaw pitch copy, shared between the
 * landing hero (`src/app/page.tsx`), the condensed landing sections
 * (hero in `src/app/page.tsx`), and the full story at `src/app/openclaw/page.tsx`.
 * All three read from these exports rather than each hand-copying the same
 * sentences — "condensed" placements slice/shorten these same arrays instead
 * of forking a second, drifting copy of the list.
 *
 * Stealth: no founder names or personal identity anywhere in this copy.
 * Product status (2026-08-07): `/install` is live — `OPENCLAW_INSTALL_COMMAND`
 * below hits a real, public, self-bootstrapping installer (public/install,
 * built from openclaw/install.sh by scripts/prebuild-openclaw.mjs), so
 * "install now" is an accurate call to action, not an overclaim. Every
 * surface reading this module should still avoid a vague "beta" label — the
 * onboarding wizard's own model-provider/API-key step is the one remaining
 * honest caveat, not the install itself.
 */

export const OPENCLAW_HEADLINE =
  "While you slept, it found jobs, tailored your resume, and filled out the form. You just hit submit.";

/**
 * Honest status qualifier for the headline above — the skill itself isn't
 * installable yet (see module comment). Rendered by `OpenclawStatusBadge`
 * (`./OpenclawStatusBadge`) wherever `OPENCLAW_HEADLINE` appears, so the
 * claim and its qualifier can never drift out of sync.
 */
export const OPENCLAW_STATUS_BADGE = "OpenClaw skill · self-hosted · free";

/**
 * The landing front door's primary CTA for people who already run OpenClaw
 * — a Homebrew-style one-liner rather than the `mcporter auth` step above
 * (that's `/openclaw`'s guided 3-step setup; this is the fast path for
 * someone who just wants the command). Hits the public installer route
 * (owned by a parallel branch as of this writing) rather than duplicating
 * its logic here.
 */
export function openclawInstallCommand(issuer: string): string {
  return `curl -fsSL ${issuer}/install | bash`;
}

/**
 * Landing instrument meta — sits above the Claude / OpenClaw / Job board
 * lanes. Problem / purpose only — never lane-specific product mechanics.
 */
export const INSTRUMENT_META = "Find the job postings that are hiring";

/**
 * Supporting line under meta — browse-free, sign-in-on-open. Shared by live
 * landing and `/mock/auth-gate`; its copy updates with ours by design.
 */
export const INSTRUMENT_SUPPORT =
    "Browse free — sign in only when you open a role.";

/** Quiet tip above unsigned `/jobs` results (session-dismissible in UI). */
export const GUEST_SERP_TIP = "Open a role to continue — details need sign-in.";

/**
 * Landing instrument — Claude / ChatGPT lane (same URL as /connect).
 *
 * A FUNCTION of the issuer, not a constant, and the same is true of the two
 * commands around it. These used to be three hand-typed copies of a hostname
 * that `AGENT.issuer()` already owned, so "change the connector base URL" meant
 * grepping for a string and hoping — and the copies could disagree with the
 * `.well-known` documents a client actually reads, which is the one way an MCP
 * connector fails silently. Server components pass `AGENT.issuer()` in; nothing
 * reads an env var a second time.
 */
export function mcpConnectorUrl(issuer: string): string {
  return `${issuer}/api/mcp`;
}
export const MCP_CONNECTOR_HINT = "Paste as a custom connector in Claude or ChatGPT. Approve once.";
export const OPENCLAW_INSTALL_HINT = "Runs on your machine. Stops before submit. Free to self-host.";

/**
 * Platform-scoped install truth for the local OpenClaw agent (D1, 2026-08-26
 * redesign). Single source for `PlatformInstallPanel`, the one component that
 * renders it — before this, /connect showed the Mac command with no waitlist
 * at all while /openclaw's closing section printed a blanket "get notified
 * when it's installable" above its own live install steps, and only
 * /connect/help told the truth ("only installs on a Mac today — there isn't
 * a Windows version yet"). Two placements reading one object can't repeat
 * that drift.
 */
export const PLATFORM_INSTALL_STATUS = {
  mac: {
    row: "macOS",
    pill: "available today",
    body: "Install now — one Terminal command.",
  },
  waitlist: {
    row: "Windows · Linux",
    pill: "waitlist",
    body: "No build yet. Leave your email and we'll tell you when yours is ready.",
  },
} as const;

export const MAC_INSTALL_COMMAND_LABEL = "Mac terminal command";

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
 *  (/openclaw) shows title + body + the copyable command on step 2.
 *  Takes the issuer for the same reason `mcpConnectorUrl` does. */
export function setupSteps(issuer: string): readonly SetupStep[] {
  return [
    { title: "Install OpenClaw", body: "The open-source assistant that runs on your own machine." },
    {
      title: "Authenticate",
      body: "Point it at velai's data with your own key. It opens a browser to sign in to velai the first time.",
      command: `mcporter auth ${mcpConnectorUrl(issuer)}`,
    },
    { title: "Scan the WhatsApp QR", body: "Pair your WhatsApp so the agent can message you drafts to review." },
  ];
}
