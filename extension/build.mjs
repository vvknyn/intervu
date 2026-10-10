#!/usr/bin/env node
/**
 * Builds the Velai Chrome extension into extension/dist/ (load that folder
 * unpacked) and, with --zip, packs extension/dist/velai-extension-<version>.zip
 * for the Chrome Web Store.
 *
 * The TypeScript is bundled with esbuild so the panel can use the site's own
 * row helpers from src/lib; everything ships inside the zip, nothing is
 * loaded from the network (the store rejects remotely hosted code).
 *
 *   node extension/build.mjs          # build dist/
 *   node extension/build.mjs --zip    # build dist/ and the store zip
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(here, "dist");
const unpacked = path.join(dist, "unpacked");
const manifest = JSON.parse(readFileSync(path.join(here, "manifest.json"), "utf8"));
// The card shows on its own only on the job sites in job-sites.json (the one
// list job-sites.ts reads too); other sites only once the person turns it on.
const jobSites = JSON.parse(readFileSync(path.join(here, "job-sites.json"), "utf8"));
manifest.content_scripts = [{ matches: jobSites.matches, js: ["card.js"], run_at: "document_idle" }];

rmSync(dist, { recursive: true, force: true });
mkdirSync(unpacked, { recursive: true });

await build({
    entryPoints: {
        background: path.join(here, "src/background.ts"),
        sidepanel: path.join(here, "src/sidepanel.ts"),
        card: path.join(here, "src/card.ts"),
        welcome: path.join(here, "src/welcome.ts"),
    },
    outdir: unpacked,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome116",
    minify: false,
    legalComments: "none",
    alias: { "@": path.join(root, "src") },
    // jsPDF's optional HTML and SVG renderers, which the résumé PDF never uses.
    external: ["html2canvas", "canvg", "dompurify"],
    logLevel: "warning",
});

// jsPDF's "open in a new window" output (never called here) writes a script
// tag for a CDN copy of PDFObject. Drop the URL so the package names no
// remotely hosted script at all.
const panelJs = path.join(unpacked, "sidepanel.js");
const REMOTE_SCRIPT = "https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js";
writeFileSync(panelJs, readFileSync(panelJs, "utf8").replaceAll(REMOTE_SCRIPT, ""));

writeFileSync(path.join(unpacked, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(path.join(here, "static"), unpacked, { recursive: true });
cpSync(path.join(here, "icons"), path.join(unpacked, "icons"), { recursive: true });
// The résumé PDF's Unicode font, the same files velai.app serves for its PDFs.
mkdirSync(path.join(unpacked, "fonts"), { recursive: true });
for (const file of ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LICENSE.txt"]) {
    cpSync(path.join(root, "public/fonts/liberation", file), path.join(unpacked, "fonts", file));
}

if (process.argv.includes("--zip")) {
    const zip = path.join(dist, `velai-extension-${manifest.version}.zip`);
    execFileSync("zip", ["-r", "-X", "-q", zip, "."], { cwd: unpacked });
    console.log(`Packed ${path.relative(root, zip)}`);
}
console.log(`Built ${path.relative(root, unpacked)} (version ${manifest.version})`);
