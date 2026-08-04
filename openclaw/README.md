# intervu-apply — OpenClaw skill

Finds intervu jobs worth applying to, tailors your resume per job, fills the
employer's application form, and leaves it ready for you to submit. It never
submits for you. Full behavior is in `SKILL.md` — this file is install-only.

## Requires

- [OpenClaw](https://docs.openclaw.ai) 2026.3.8+ (`openclaw --version`),
  with WhatsApp (or your configured channel) already linked for
  `openclaw message send`.
- `mcporter` (bundled OpenClaw skill / npm package) for the intervu MCP
  bridge.

## Install

```bash
curl -fsSL https://intervu.cc/install | bash
```

No repo checkout needed — the command above works standalone.

What it does, in order:

- Confirms OpenClaw is installed. If not, installs it (`npm i -g openclaw`)
  and hands off to OpenClaw's own `openclaw onboard` wizard — model
  provider, API keys, and channel/WhatsApp linking are its call, not this
  script's — then continues automatically once onboarding finishes.
- Installs `mcporter` if it isn't already on your machine.
- Registers the intervu MCP server (`intervu-cc-mcp`) with mcporter, if not
  already registered.
- Runs `mcporter auth intervu-cc-mcp` — a browser window opens for you to
  approve access (see landmine below on timing).
- Downloads this skill's tarball from intervu.cc and installs it into
  `~/.openclaw/skills/intervu-apply`.
- Restarts the OpenClaw gateway so it picks up the newly installed skill.
- Arms the `intervu-apply-digest` (`0 8 * * *`) and `intervu-apply-recap`
  (`0 18 * * 0`) cron jobs, skipping either that's already armed.

Every step is safe to re-run.

`state/` inside the installed skill dir is created lazily on first run — see
`SKILL.md`'s State section for the schema. Nothing needs to be pre-seeded.

## Landmines

- **The OAuth window during `mcporter auth` is short — about 60 seconds.**
  Be ready to click through it as soon as `install.sh` opens it.
- **Start a FRESH agent session after installing.** Send `/new` on WhatsApp
  — a session already running won't pick up the newly installed skill.
- **mcporter's config lives at `~/.mcporter/mcporter.json`.**
- **Never trust `mcporter list`'s auth-status labels.** Its health probe
  reports "auth required" even when stored credentials are valid; the only
  reliable check is an actual tool call.

## Managing the cron jobs

`install.sh` arms both cron jobs for you (see Install above). To inspect,
change, or remove them directly: `openclaw cron list` / `openclaw cron rm
<name>`.

## Uninstall

```bash
rm -rf ~/.openclaw/skills/intervu-apply
openclaw cron rm intervu-apply-digest
openclaw cron rm intervu-apply-recap
```
