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
  const filled = fillTemplate(template, data);

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, filled, "utf8");
  console.log(args.out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
