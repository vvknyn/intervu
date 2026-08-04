#!/usr/bin/env node
// Fills ../templates/resume.html with tailored resume content and writes a
// standalone HTML file, ready for `browser open file://<path>` -> `browser pdf`.
//
// Dependency-free by design: stdlib fs/path/url only, plain {{TOKEN}} string
// substitution. No template engine. This exists so the resume's structure and
// CSS are consistent across every run instead of an LLM re-inventing markup
// per job — see ../templates/resume.html for the token contract.
//
// Usage:
//   node render-resume.mjs --data <json-path> --out <html-path> [--template <html-path>]
//
// --data points at a flat JSON object of TOKEN -> string (see the template's
// header comment for which tokens are plain text vs. pre-built HTML
// fragments). Any {{TOKEN}} in the template with no matching key in the data
// file is replaced with "" — never left as a literal "{{TOKEN}}" in output.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE = join(__dirname, "..", "templates", "resume.html");

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

// Single source of truth for the substitution rule — the template's tokens
// are exactly the {{UPPER_SNAKE}} spans; anything not supplied renders empty
// rather than leaking a literal "{{TOKEN}}" into the output.
export function fillTemplate(template, data) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_match, token) =>
    Object.prototype.hasOwnProperty.call(data, token) ? String(data[token]) : ""
  );
}

// Sections in this template are not nested, so a non-greedy match across
// <section ...>...</section> safely captures each one as a single block.
const SECTION_RE = /<section\b([^>]*)>([\s\S]*?)<\/section>/g;

// Pure decision, no I/O: every content section in the template declares its
// owning token via data-token="TOKEN" (see templates/resume.html). A section
// whose token is empty/whitespace/missing in `data` is dropped entirely
// (heading included) unless it's marked data-required, in which case this
// throws instead — the caller decides how to report that. Kept sections have
// their authoring attributes (data-token/data-required) stripped so they
// don't leak into shipped HTML. New sections need zero changes here: nothing
// in this function names a section — it only reads the attribute.
export function pruneEmptySections(html, data) {
  return html.replace(SECTION_RE, (match, attrs, body) => {
    const tokenMatch = attrs.match(/data-token="([A-Z_]+)"/);
    if (!tokenMatch) return match;
    const token = tokenMatch[1];
    const value = data[token];
    const isEmpty = !value || !String(value).trim();
    if (!isEmpty) {
      const cleanAttrs = attrs
        .replace(/\s*data-token="[A-Z_]+"/, "")
        .replace(/\s*data-required\b/, "");
      return `<section${cleanAttrs}>${body}</section>`;
    }
    if (/\bdata-required\b/.test(attrs)) {
      throw new Error(`required section ${token} is empty`);
    }
    return "";
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.data || !args.out) {
    console.error(
      "Usage: render-resume.mjs --data <json-path> --out <html-path> [--template <html-path>]"
    );
    process.exit(1);
  }

  const templatePath = args.template || DEFAULT_TEMPLATE;
  const template = readFileSync(templatePath, "utf8");
  const data = JSON.parse(readFileSync(args.data, "utf8"));

// Fail LOUDLY on unusable data — a resume with no name must never render
// "successfully" as a blank page (that exact silent-blank shipped once; see
// SKILL.md §2 step 7). Every-section-empty is a special case of "a required
// section is empty" (EXPERIENCE is data-required in the template), so it's
// already covered by pruneEmptySections below — no separate check needed.
if (!data.NAME || !String(data.NAME).trim()) {
  console.error("render-resume: refusing to render — NAME is empty. Check the data file matches the token contract in templates/resume.html.");
  process.exit(1);
}
  const filled = fillTemplate(template, data);

  let finalHtml;
  try {
    finalHtml = pruneEmptySections(filled, data);
  } catch (err) {
    console.error(`render-resume: refusing to render — ${err.message}. Check the data file matches the token contract in templates/resume.html.`);
    process.exit(1);
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, finalHtml, "utf8");
  console.log(args.out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
