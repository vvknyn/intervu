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
# 1. Auth against the intervu MCP server (OAuth flow opens in your browser)
mcporter auth https://intervu.cc/api/mcp

# 2. Copy this skill into OpenClaw's workspace skills dir
cp -R openclaw ~/.openclaw/workspace/skills/intervu-apply

# 3. Confirm it's discovered and its requirements are met
openclaw skills list
openclaw skills check
```

`state/` inside the installed skill dir is created lazily on first run — see
`SKILL.md`'s State section for the schema. Nothing needs to be pre-seeded.

## Schedule the morning digest

```bash
openclaw cron add \
  --name intervu-morning-digest \
  --cron "0 8 * * 1-5" \
  --tz "America/Los_Angeles" \
  --message "Run the intervu-apply morning digest." \
  --announce
```

Adjust `--cron`/`--tz` to taste. `openclaw cron list` / `openclaw cron rm`
manage it after.

## Pending-deploy note (read before relying on PREPARE)

`SKILL.md`'s PREPARE step calls three intervu MCP tools that are **on an
in-flight branch, not yet deployed**: `get_resume`, `save_resume_variant`,
`get_resume_variant`. Until that branch ships, calls to them will error —
the skill is written to surface that error and stop rather than fabricate
resume content. `search_jobs`, `get_job`, `save_job`, and `mark_applied` are
live now, so the MORNING DIGEST and RECORD steps work today.

## Verifying the MCP server key

`SKILL.md` assumes `mcporter auth` registers the server under the key
`intervu` (`mcporter call intervu.<tool> ...`). Confirm with `mcporter list`
after step 1 above — if it registers under a different key, that's the only
place the name needs to change; nothing else in the skill depends on it.

## Uninstall

```bash
rm -rf ~/.openclaw/workspace/skills/intervu-apply
openclaw cron rm intervu-morning-digest
```
