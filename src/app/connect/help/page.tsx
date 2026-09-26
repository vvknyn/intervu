import type { Metadata } from "next";
import Link from "next/link";
import { mcpConnectorUrl, openclawInstallCommand } from "@/components/marketing/openclaw-content";
import { AGENT } from "@/lib/agent/config";

export const metadata: Metadata = {
  title: "Setup help — velai",
  description:
    "Troubleshooting for connecting your AI to velai — the Claude connector (no install) and the OpenClaw local agent (Mac install). Find the exact step that failed and what to do next.",
  robots: { index: false, follow: true },
};

/** Ordered id + label pairs — the single source for both the on-page table
 *  of contents and the anchor ids below. This exact list, in this exact
 *  order, is a contract with `openclaw/install.sh`: every fatal exit there
 *  prints `$INTERVU_BASE/connect/help#<id>`, so an id typo here is a
 *  dead link from a real failed install, not just a broken TOC. */
const SECTIONS = [
  { id: "which-path", label: "Which path is right for you?" },
  { id: "connector", label: "The Claude connector" },
  { id: "windows", label: "Windows" },
  { id: "install-node", label: "Setting up the runtime automatically" },
  { id: "node-version", label: "An old runtime quietly gave you an outdated OpenClaw" },
  { id: "onboarding", label: "The onboarding wizard (model + API key)" },
  { id: "auth", label: "The 60-second browser approval" },
  { id: "skill-download", label: "Skill download failed" },
  { id: "gateway", label: "The gateway won't start" },
  { id: "whatsapp", label: "Pairing WhatsApp" },
  { id: "uninstall", label: "Uninstalling" },
  { id: "stuck", label: "Still stuck" },
] as const;

function HelpSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-border py-8 first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

/** A single command shown for the user to type or re-run — same visual
 *  weight as `connect-client.tsx`'s CopyUrlBar (border-2, mono), but static:
 *  this page has no client-side state, so there's no copy button here. */
function Command({ children }: { children: string }) {
  return (
    <code className="block overflow-x-auto rounded-none bg-muted px-3.5 py-2.5 text-sm text-foreground">
      {children}
    </code>
  );
}

export default function ConnectHelpPage() {
  // Built from the connector's own origin, so a troubleshooting page can never
  // tell someone to paste a URL the `.well-known` documents disagree with.
  const issuer = AGENT.issuer();
  const MCP_CONNECTOR_URL = mcpConnectorUrl(issuer);
  const OPENCLAW_INSTALL_COMMAND = openclawInstallCommand(issuer);
  return (
    <div data-testid="connect-help-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-semibold text-muted-foreground">
        Setup help
      </p>
      <h1 className="mt-2 text-title-lg font-semibold text-foreground">
        Connecting your AI to velai
      </h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        Two ways to connect: a connector you paste into an AI client you already use, or a local
        agent you install on your own Mac. If an install failed and sent you here, find the
        section it named below — each one covers what happened, why, and what to do next. Start
        at{" "}
        <Link href="/connect" className="text-brand underline-offset-4 hover:underline">
          /connect
        </Link>{" "}
        if you haven&apos;t begun yet.
      </p>

      <nav aria-label="On this page" className="mt-8 border border-border p-5">
        <p className="text-xs font-semibold text-foreground">On this page</p>
        <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-brand underline-offset-4 hover:underline">
                {s.label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-2">
        <HelpSection id="which-path" title={SECTIONS[0].label}>
          <p>
            The connector is like using a website: nothing installs, it works on any computer, and
            it&apos;s the default for most people. In Claude&apos;s settings, you paste in an address
            and approve it once — that&apos;s it.
          </p>
          <p>
            The local agent is like installing a desktop app: it lives on your own Mac, can message
            you on WhatsApp, and can work in the background even when you&apos;re not actively
            chatting. It&apos;s the power-user path, Mac-only today, and it takes a few more minutes
            to set up.
          </p>
          <p>
            If you&apos;re not sure, use the connector first — jump to{" "}
            <a href="#connector" className="text-brand underline-offset-4 hover:underline">
              The Claude connector
            </a>
            . On Windows, the local agent isn&apos;t available yet; see{" "}
            <a href="#windows" className="text-brand underline-offset-4 hover:underline">
              Windows
            </a>
            .
          </p>
        </HelpSection>

        <HelpSection id="connector" title={SECTIONS[1].label}>
          <p>
            In Claude, open Settings → Connectors → Add custom connector and paste this address:
          </p>
          <Command>{MCP_CONNECTOR_URL}</Command>
          <p>
            Think of it as giving Claude a phone number it can call whenever you ask it something
            about jobs — nothing downloads or installs on your computer. Claude will ask you to
            approve the connection once; after that, just ask it to search or track jobs.
          </p>
          <p>
            Out of the box, this gets you search and tracking: ask your AI to find roles,
            sanity-check a posting, or save something to your tracker, and it can do that right
            away. Actually opening a listing and filling out the application form needs a
            different kind of tool — one with browser control, like Claude Code. Either way,
            nothing here ever submits an application by itself; you&apos;re always the one who
            hits submit.
          </p>
          <p>
            One more thing worth knowing: the job descriptions your AI reads through this
            connector are text pulled from the original posting elsewhere on the web, not
            something velai wrote. Every response labels that text as data for your AI to read,
            never as instructions for it to follow — so a strange line buried in a posting
            can&apos;t quietly make your AI do something you didn&apos;t ask for.
          </p>
          <p>
            If Claude&apos;s settings don&apos;t show a connectors option yet, it&apos;s still rolling
            out to accounts — try the OpenClaw local agent instead (Mac only), or check back
            shortly.
          </p>
        </HelpSection>

        <HelpSection id="windows" title={SECTIONS[2].label}>
          <p>
            The local agent (OpenClaw) only installs on a Mac today — there isn&apos;t a Windows
            version yet. The Claude connector above works fine on Windows right now: nothing to
            install, same steps as any other computer.
          </p>
          <p>
            If you specifically want the local agent, the OpenClaw tab on{" "}
            <Link href="/connect" className="text-brand underline-offset-4 hover:underline">
              /connect
            </Link>{" "}
            has a &ldquo;tell me when Windows is ready&rdquo; signup — that list is what tells us
            how many people are waiting on it.
          </p>
        </HelpSection>

        <HelpSection id="install-node" title={SECTIONS[3].label}>
          <p>
            The local agent needs a small program called Node to actually run — think of it as the
            engine under the hood, the same way an app needs the right version of iOS or Android
            underneath it. Most Macs don&apos;t have it by default, and older install scripts used
            to just tell you to go install it yourself, which is exactly where a real install died
            recently.
          </p>
          <p>
            This installer no longer asks you to do that. If Node isn&apos;t already on your Mac, it
            downloads its own private copy into a folder that belongs only to you
            (<code className="text-xs">~/.openclaw/runtime</code>), checks it against
            the official checksum published by nodejs.org so you know it wasn&apos;t tampered with,
            and adds one line to a personal settings file
            (<code className="text-xs">~/.zprofile</code>, marked &ldquo;# intervu
            installer: local Node runtime&rdquo;) so your Terminal can find it every time you open a
            new window. No admin password, nothing installed system-wide.
          </p>
          <p>
            If this step failed, it&apos;s almost always a dropped network connection to
            nodejs.org. Re-run the install command below — it&apos;s safe to run as many times as you
            need, it skips whatever already finished:
          </p>
          <Command>{OPENCLAW_INSTALL_COMMAND}</Command>
        </HelpSection>

        <HelpSection id="node-version" title={SECTIONS[4].label}>
          <p>
            What happened: on a real install (Aug 5), someone&apos;s Mac already had an old copy of
            Node from before this installer existed. That old copy caused OpenClaw to silently
            install an older version of itself — and WhatsApp pairing then failed with a confusing
            error about a &ldquo;plugin API&rdquo; version, which doesn&apos;t mention Node at all.
          </p>
          <p>
            Why: a too-old engine can only run an older build of the app on top of it, so the
            install quietly downgrades instead of failing outright — you don&apos;t find out until a
            later step breaks for an unrelated-looking reason.
          </p>
          <p>
            The fix is simple: just re-run the install command. It now brings its own current
            runtime (see{" "}
            <a href="#install-node" className="text-brand underline-offset-4 hover:underline">
              Setting up the runtime automatically
            </a>
            ) instead of trusting whatever was already on your Mac, so this shouldn&apos;t happen
            again.
          </p>
          <Command>{OPENCLAW_INSTALL_COMMAND}</Command>
        </HelpSection>

        <HelpSection id="onboarding" title={SECTIONS[5].label}>
          <p>
            Partway through, OpenClaw hands you off to its own setup wizard — not something velai
            runs. It asks you to pick an AI model provider (for example, Anthropic, the company
            behind Claude) and paste in a personal API key for it: an account you set up yourself,
            which can bill you separately for what the agent uses.
          </p>
          <p>
            We&apos;ll say it plainly: this is genuinely the hardest step in today&apos;s install, and
            there&apos;s no shortcut around it yet — you do need an account with a model provider and
            a key from it.
          </p>
          <p>
            If the wizard didn&apos;t finish, open Terminal (the app where you type commands) and run:
          </p>
          <Command>openclaw onboard</Command>
          <p>Once that completes, re-run the install command:</p>
          <Command>{OPENCLAW_INSTALL_COMMAND}</Command>
        </HelpSection>

        <HelpSection id="auth" title={SECTIONS[6].label}>
          <p>
            Near the end of the install, a browser window opens automatically asking you to approve
            the connection between your Mac and velai. It waits about 60 seconds for you to click
            through — like a sign-in link that expires quickly, it&apos;s timed on purpose so a
            connection can&apos;t be approved by someone else later without you noticing.
          </p>
          <p>
            If you missed the window, nothing is broken — just re-run the install command below. It
            skips every step that already finished and opens a fresh approval window; this time,
            have the browser ready to click through right away.
          </p>
          <Command>{OPENCLAW_INSTALL_COMMAND}</Command>
        </HelpSection>

        <HelpSection id="skill-download" title={SECTIONS[7].label}>
          <p>
            Near the end of the install, the script downloads velai&apos;s actual job-search
            instructions and installs them into OpenClaw. This step failed — almost
            always a network hiccup (a dropped connection), not a problem with your account or
            anything installed so far.
          </p>
          <p>
            Re-run the install command; it only retries the download and leaves everything already
            set up untouched:
          </p>
          <Command>{OPENCLAW_INSTALL_COMMAND}</Command>
        </HelpSection>

        <HelpSection id="gateway" title={SECTIONS[8].label}>
          <p>
            OpenClaw runs a small background helper that stays on and watches for things like
            incoming WhatsApp messages — think of it like a mail server quietly running in the
            background, always listening. After install, it takes a few seconds to start back up,
            and the installer waits up to 30 seconds for it before giving up.
          </p>
          <p>
            If it&apos;s still not answering after that, open Terminal and run:
          </p>
          <Command>openclaw gateway status</Command>
          <p>That tells you what it&apos;s actually doing. Then re-run the install command:</p>
          <Command>{OPENCLAW_INSTALL_COMMAND}</Command>
        </HelpSection>

        <HelpSection id="whatsapp" title={SECTIONS[9].label}>
          <p>
            Pairing WhatsApp — scanning a QR code to link the chat — happens inside OpenClaw&apos;s own
            onboarding wizard, not as a separate step this installer runs. If the wizard reaches
            that point and pairing fails or the QR code won&apos;t scan, the usual cause is the
            outdated-OpenClaw problem above: an old runtime quietly installed a version of OpenClaw
            whose WhatsApp piece doesn&apos;t work correctly.
          </p>
          <p>
            See{" "}
            <a href="#node-version" className="text-brand underline-offset-4 hover:underline">
              An old runtime quietly gave you an outdated OpenClaw
            </a>{" "}
            and re-run the install command — it now brings a current runtime, which fixes this in
            most cases.
          </p>
        </HelpSection>

        <HelpSection id="uninstall" title={SECTIONS[10].label}>
          <p>
            You can remove everything the local agent installed. In Terminal, run:
          </p>
          <Command>rm -rf ~/.openclaw ~/.mcporter</Command>
          <p>
            Then open{" "}
            <code className="text-xs">~/.zprofile</code> in a text editor, find the
            line that reads <code className="text-xs">
              # intervu installer: local Node runtime
            </code>
            , and delete that line and the one right after it. If your Mac already had Node
            installed before you ran this installer, nothing else on your machine was touched — the
            runtime folder above was a separate, private copy the installer added just for itself.
          </p>
          <p>
            Your WhatsApp link dies along with the agent — there&apos;s nothing left to message. And
            nothing about you stays behind on velai&apos;s servers from the local agent: it runs
            entirely on your own machine, and the only thing that ever left it was job-matching
            queries to velai, the same way your browser talks to any website you visit.
          </p>
        </HelpSection>

        <HelpSection id="stuck" title={SECTIONS[11].label}>
          <p>
            If none of the above covers it, use the{" "}
            <Link href="/contact" className="text-brand underline-offset-4 hover:underline">
              contact page
            </Link>{" "}
            — we read everything that comes through there. It helps to mention which step you were
            on and what the terminal or Claude showed you. You can also go back to{" "}
            <Link href="/connect" className="text-brand underline-offset-4 hover:underline">
              /connect
            </Link>{" "}
            and try the other path — the connector needs nothing installed at all.
          </p>
        </HelpSection>
      </div>
    </div>
  );
}
