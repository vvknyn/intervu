#!/usr/bin/env node
/**
 * Packages openclaw/ into public/ so the curl|bash installer
 * (https://intervu.cc/install) and its skill payload
 * (https://intervu.cc/intervu-apply-skill.tar.gz) are servable as static
 * files, with no repo checkout required on the install side.
 *
 * Runs automatically as npm's "prebuild" hook, i.e. inside `npm run build`
 * — see package.json. Pure local file ops, no network: the Dockerfile's
 * `builder` stage runs this before `next build`, and only what lands in
 * public/ by then survives into the `runner` stage's `COPY --from=builder
 * /app/public ./public` (openclaw/ itself is not present at runtime).
 *
 * openclaw/install.sh stays the single canonical source; public/install is
 * a byte-for-byte derived copy, regenerated every build, never hand-edited.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const openclawDir = join(root, "openclaw");
const publicDir = join(root, "public");

mkdirSync(publicDir, { recursive: true });

// Skill payload: everything under openclaw/ except install.sh (which has no
// business being inside a user's ~/.openclaw/skills/intervu-apply — it's the
// installer, not the skill). Exclude-based so new files added to openclaw/
// later (e.g. more templates/scripts) are packaged automatically.
execFileSync(
  "tar",
  ["--exclude=install.sh", "-czf", join(publicDir, "intervu-apply-skill.tar.gz"), "-C", openclawDir, "."],
  { stdio: "inherit" },
);

// Installer: served at /install so `curl -fsSL https://intervu.cc/install |
// bash` works with no repo access at all.
copyFileSync(join(openclawDir, "install.sh"), join(publicDir, "install"));

console.log("prebuild-openclaw: wrote public/intervu-apply-skill.tar.gz and public/install");
