# Install funnel rework — 2026-08-07

## Why

A real-family test (Aug 7) died three times before product touch: (1) Windows
laptop — the only install surface is a bash one-liner; (2) Mac without npm —
`install.sh` ran `npm i -g openclaw` with no guard and died with "command not
found"; (3) told to "install npm", a non-technical person has no idea what
that means, and the script's own remediation copy was developer-speak.
Meta-cognition L-141: an install deliverable is a FUNNEL (landing page → OS →
prerequisites → script → auth → first run → recovery page), not a script.

## Decisions (Vivek, Aug 7)

- Full funnel fix in one pass, not FAQ-only, not spec-only.
- Route by persona: the claude.ai MCP connector is the default path for
  non-technical users (zero install, all OSes). The OpenClaw local agent is
  the Mac power-user path. Windows local agent: honest gate + notify-me.

## Persona × OS matrix

| | macOS | Windows | Linux |
|---|---|---|---|
| Uses Claude at claude.ai | connector (default) | connector (default) | connector |
| Wants the local apply agent | `curl … | bash` (self-bootstrapping) | gate + notify-me (waitlist action) | script; Node must pre-exist (dev audience) |
| Neither / lost | /connect/help #which-path | same | same |

## The three layers

1. **/connect routes by what the person has.** Client-side OS detection
   (pure helper, unit-tested for mac AND windows AND linux). The OpenClaw tab
   on a non-Mac shows a plain-language "Mac only today" band with notify-me
   (reuses `joinConnectWaitlist` — still live server-side, 5/10min IP rate
   limit) instead of a command that cannot run. Every tab links to the help
   page.
2. **The installer installs its own prerequisites.** Missing npm on a Mac →
   download the official Node LTS tarball (checksum-verified against
   SHASUMS256.txt) into user-owned `~/.openclaw/runtime/current`, no sudo,
   PATH persisted via a marker-guarded block in `~/.zprofile`. Rule: never
   tell a user to install a prerequisite. Also: python3 JSON edit → node
   (fresh Macs pop the Apple developer-tools dialog on python3).
3. **Every failure lands on a page.** New public `/connect/help`
   (carved out of the prefix login gate — support content must be reachable
   logged-out). Every `exit 1` in install.sh prints
   `More help: https://intervu.cc/connect/help#<anchor>`.

## Anchor contract (installer ↔ help page)

`#which-path` `#connector` `#windows` `#install-node` `#node-version`
`#onboarding` `#auth` `#skill-download` `#gateway` `#whatsapp` `#uninstall`
`#stuck`

## Load-bearing implementation facts

- `/install` is `public/install`, copied byte-for-byte from
  `openclaw/install.sh` by `scripts/prebuild-openclaw.mjs` (npm prebuild) —
  script changes ship with the next site build, ungated by middleware.
- The gateway is a launchd agent (`ai.openclaw.gateway`); launchd does not
  read shell profiles. `openclaw onboard` runs with the installer's PATH, so
  the bootstrapped runtime must be on PATH before onboarding. Needs one
  real fresh-Mac verification (sandbox can't reach real launchd — shimmed).
- /connect tabs are hand-rolled (`connect-client.tsx`), a documented debt
  (DESIGN-LANGUAGE.md: don't add a third hand-rolled switcher). Rework stays
  within the existing tablist; no new switcher pattern.
- Help page: `text-title` headings (not `text-display`), radius 0, no
  shadows, `ui/**` primitives, no raw hex.
- Stale comments to fix in passing: `openclaw-content.ts:9-17` ("product is
  unshipped — never install now") and `connect-waitlist.ts:11` ("MCP backend
  hasn't deployed yet") — both contradicted by shipped reality.

## Open questions (flagged, not decided here)

- `/connect` itself is login-gated: a brand-new person hits the signup wall
  before seeing what connecting even means. Left as-is this pass; Vivek to
  decide whether the funnel entry should be public.
- openclaw's own onboarding wizard requires a model provider + API key —
  the tallest remaining wall for a family-grade user on the local path. The
  help page says so honestly (#onboarding); solving it (bundled key, hosted
  relay…) is a product decision with cost implications, deliberately out of
  scope.
- Windows local-agent support (PowerShell installer) — deferred; notify-me
  measures demand.
