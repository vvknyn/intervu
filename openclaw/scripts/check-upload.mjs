#!/usr/bin/env node
// Mechanically asserts that the resume filename the ATS actually attached
// matches the filename the user was shown (in Downloads, in the RESUME tab,
// in the review blurb) — turning "does the uploaded file match what I
// reviewed" from a thing the model must remember to check into a thing that
// fails loudly if it's wrong. See SKILL.md POST-FILL AUDIT.
//
// Usage:
//   node scripts/check-upload.mjs --expect <filename> [--audit <path>]
// Reads form-audit.js's output (see scripts/form-audit.js) from --audit or
// stdin, finds the resume file control, and compares the DOM-reported
// filename against --expect. Exits 0 on an exact match; exits 1 naming both
// strings otherwise (including when no file control has a filename at all).
//
// INPUT SHAPE
// `openclaw browser evaluate --fn "$(cat form-audit.js)"` (no --json) prints
// the page function's return value JSON.stringify'd a SECOND time by the CLI
// itself — form-audit.js already returns a JSON string, so raw stdout is a
// double-encoded string (verified live 2026-08-04). parseAuditPayload below
// unwraps either that double-encoding or a plain audit object, so synthetic
// test fixtures (single-encoded) and real CLI output both work unmodified.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

// Pure: JSON.parse once, and again if that yields a string (the CLI's
// double-encoding above) rather than the audit object itself.
export function parseAuditPayload(raw) {
  let value = JSON.parse(raw);
  if (typeof value === "string") value = JSON.parse(value);
  return value;
}

// Pure decision: which file control is "the resume" among however many file
// inputs the form has (Ashby forms also carry an optional cover-letter
// upload, see form-audit.js live output). A control whose recovered label
// mentions "resume" wins even if empty, so a genuinely-empty resume field
// is reported as such rather than silently falling back to some other
// attached file. Only forms with no resume-labeled control fall back to
// "the first file control that has anything attached".
function findResumeControl(controls) {
  const fileControls = controls.filter((c) => c.type === "file");
  const labeled = fileControls.find((c) => /resume/i.test(c.label || ""));
  if (labeled) return labeled;
  return fileControls.find((c) => c.state) || null;
}

// Pure decision, no I/O: given a parsed audit object and the expected
// filename, decide match / mismatch / missing. The CLI wrapper below turns
// this into an exit code.
export function checkUpload(audit, expected) {
  const control = findResumeControl(audit.controls || []);
  if (!control || !control.state) {
    return {
      ok: false,
      message: `no file control has a filename attached (expected "${expected}")`,
    };
  }
  if (control.state === expected) {
    return { ok: true, message: `upload matches: "${expected}"` };
  }
  return {
    ok: false,
    message: `upload filename mismatch: form shows "${control.state}", expected "${expected}"`,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.expect) {
    console.error("Usage: check-upload.mjs --expect <filename> [--audit <path>]");
    process.exit(1);
  }

  const raw = args.audit ? readFileSync(args.audit, "utf8") : readFileSync(0, "utf8");
  let audit;
  try {
    audit = parseAuditPayload(raw);
  } catch (err) {
    console.error(`check-upload: could not parse audit JSON — ${err.message}`);
    process.exit(1);
  }

  const result = checkUpload(audit, args.expect);
  console[result.ok ? "log" : "error"](result.message);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
