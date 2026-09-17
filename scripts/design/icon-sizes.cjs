#!/usr/bin/env node
// Icon-size gate + codemod (rulebook v2 clause 6: icons are 16px, 20px only
// inside a 40px control, 24px for display glyphs; nothing else).
//
// Consumed by BOTH tests/unit/design-language.test.ts (detection, via
// `findIconSizeOffenders`) and `node scripts/design/icon-sizes.cjs --apply`
// (rewrite). The scan is import-aware: only JSX elements whose tag name was
// imported from @phosphor-icons/react (either entry point) are inspected,
// so an unrelated numeric `size` prop (an avatar, a pagination control) is
// never touched — no filename or component-name list is enumerated here.
//
// That import-awareness also follows one level of local indirection: a
// module that re-exports an object literal mapping every one of its own
// keys to an icon it imported from the package (shape-based — no map's
// name is hand-enumerated) is an icon lookup map, and BOTH ways a caller
// can render through it are covered: `<MapName.someKey size={...} />`
// (member-expression tag) and `const Icon = MapName[key]; <Icon .../>`
// (computed lookup bound to a local var, then used as a bare tag).
//
// Rewrite rules (deterministic, then eyeballed on the route screenshots):
//   size ∈ {16, 20, 24}         → untouched
//   size ≤ 21 (not allowed)     → prop removed (the IconDefaultsProvider makes
//                                  16px the default), EXCEPT in files that
//                                  import the /dist/ssr entry point, which
//                                  cannot read that context — there the prop
//                                  becomes an explicit size={16}
//   size ≥ 22 (not allowed)     → size={24}
//   className tokens h-/w-/size- below 4 (i.e. <16px) on those same
//   elements → removed, since a Tailwind height overrides the SVG attribute.
//   /dist/ssr elements with NO size or NO weight prop → size={16} and
//   weight="bold" added (the ssr entry renders 1em / regular otherwise,
//   which is neither the 16px nor the stroke the rest of the app gets from
//   IconDefaultsProvider).
"use strict";
const path = require("path");
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { walkTsxFiles, isFileAllowed, ROOT } = require("./banned-classes.cjs");

const ALLOWED = new Set([16, 20, 24]);
const IMPORT_RE = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["'](@phosphor-icons\/react(?:\/dist\/ssr)?)["']/g;
// Names that come from the package but are not icon components.
const NON_ICON_EXPORTS = new Set(["IconContext", "IconProps", "IconWeight", "Icon", "IconBase", "SSR"]);
const SMALL_TW_SIZE_RE = /(?:^|\s)(?:[\w-]+:)*(?:h|w|size)-(?:1|1\.5|2|2\.5|3|3\.5)(?=\s|$)/g;
// A same-file/local-alias import — the only kind an icon lookup map can be
// re-exported through (a package like @phosphor-icons/react is handled by
// IMPORT_RE above and never itself a local map).
const LOCAL_IMPORT_RE = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["'](\.[^"']*|@\/[^"']*)["']/g;

function importedIconNames(src) {
    const names = new Set();
    let ssr = false;
    for (const m of src.matchAll(IMPORT_RE)) {
        if (m[2].endsWith("/dist/ssr")) ssr = true;
        for (const part of m[1].split(",")) {
            const p = part.trim().replace(/^type\s+/, "");
            if (!p) continue;
            const alias = p.split(/\s+as\s+/);
            const local = (alias[1] || alias[0]).trim();
            if (local && !NON_ICON_EXPORTS.has(local)) names.add(local);
        }
    }
    return { names: [...names], ssr };
}

/** Resolves a relative or `@/`-aliased import specifier (the one path alias
 *  this repo defines: @/* -> src/*, tsconfig.json) to an absolute .ts(x)
 *  file, or null for anything else (a package import). */
function resolveLocalModule(specifier, fromFile) {
    let base;
    if (specifier.startsWith("@/")) {
        base = path.join(ROOT, "src", specifier.slice(2));
    } else if (specifier.startsWith(".")) {
        base = path.resolve(path.dirname(fromFile), specifier);
    } else {
        return null;
    }
    for (const ext of ["", ".tsx", ".ts"]) {
        if (existsSync(base + ext)) return base + ext;
    }
    return null;
}

/**
 * Finds `export const X = { ... }` object literals in a module whose every
 * value is a name THAT SAME module imported from @phosphor-icons/react —
 * an icon lookup map, identified by shape (what it's built from), never by
 * enumerating a map's name.
 */
function iconMapExportNames(moduleSrc) {
    const { names: iconNames } = importedIconNames(moduleSrc);
    if (!iconNames.length) return [];
    const iconSet = new Set(iconNames);
    const found = [];
    for (const m of moduleSrc.matchAll(/export const (\w+)(?::[^=]+)?\s*=\s*\{([^}]*)\}/g)) {
        const values = [...m[2].matchAll(/:\s*(\w+)\s*,?/g)].map((v) => v[1]);
        if (values.length && values.every((v) => iconSet.has(v))) found.push(m[1]);
    }
    return found;
}

/** Local names (in `src`, imported from `filePath`'s own local imports)
 *  bound to an icon lookup map defined in another module. */
function resolveIconMapNames(src, filePath) {
    const mapNames = new Set();
    for (const m of src.matchAll(LOCAL_IMPORT_RE)) {
        const resolved = resolveLocalModule(m[2], filePath);
        if (!resolved) continue;
        let modSrc;
        try {
            modSrc = readFileSync(resolved, "utf8");
        } catch {
            continue;
        }
        const mapExports = new Set(iconMapExportNames(modSrc));
        if (!mapExports.size) continue;
        for (const part of m[1].split(",")) {
            const p = part.trim().replace(/^type\s+/, "");
            if (!p) continue;
            const alias = p.split(/\s+as\s+/);
            const imported = alias[0].trim();
            const local = (alias[1] || alias[0]).trim();
            if (mapExports.has(imported)) mapNames.add(local);
        }
    }
    return mapNames;
}

function lineOf(src, index) {
    return src.slice(0, index).split("\n").length;
}

/** Rewrites one element's attribute string; returns {attrs, changes[]}. */
function fixAttrs(attrs, { ssr }) {
    const changes = [];
    let out = attrs.replace(/\bsize=(?:\{\s*(\d+)\s*\}|"(\d+)")/g, (whole, a, b) => {
        const n = Number(a ?? b);
        if (ALLOWED.has(n)) return whole;
        if (n >= 22) { changes.push(`size ${n}→24`); return "size={24}"; }
        if (ssr) { changes.push(`size ${n}→16 (ssr entry, explicit)`); return "size={16}"; }
        changes.push(`size ${n}→default(16)`);
        return "";
    });
    out = out.replace(/className=(["'])([^"']*)\1/g, (whole, q, cls) => {
        const cleaned = cls.replace(SMALL_TW_SIZE_RE, " ").replace(/\s+/g, " ").trim();
        if (cleaned === cls.trim()) return whole;
        changes.push(`className "${cls.trim()}"→"${cleaned}"`);
        return cleaned ? `className=${q}${cleaned}${q}` : "";
    });
    if (ssr && !/\bsize=/.test(out)) { changes.push("ssr entry: size={16} added"); out = out.trimEnd() + " size={16}"; }
    if (ssr && !/\bweight=/.test(out)) { changes.push('ssr entry: weight="bold" added'); out = out.trimEnd() + ' weight="bold"'; }
    if (changes.length) out = out.replace(/[ \t]{2,}/g, " ").replace(/\s+(\/?)$/, (m, s) => (s ? " /" : ""));
    return { attrs: out, changes };
}

/**
 * Scans a source string; returns {offenders, rewritten}. `offenders` is
 * [{line, tag, detail}]; `rewritten` is the fixed source (=== src when clean).
 * `filePath` (optional) enables the local icon-map indirection scan — pass
 * it whenever `src` was read from disk (its absolute path resolves any
 * relative/`@/` import it makes); omit it for a synthetic fixture string
 * that has no filesystem home.
 */
function scanSource(src, filePath) {
    const { names: importedNames, ssr } = importedIconNames(src);
    const mapNames = filePath ? resolveIconMapNames(src, filePath) : new Set();
    // Pattern (b): `const Icon = MapName[key]` / `const Icon = MapName.key`
    // binds a local name that is then used as an ordinary bare tag.
    const localVarNames = [];
    for (const mapName of mapNames) {
        const escaped = mapName.replace(/[$]/g, "\\$&");
        const varRe = new RegExp(`const\\s+(\\w+)\\s*=\\s*${escaped}\\s*(?:\\[[^\\]]+\\]|\\.[A-Za-z_$][\\w$]*)`, "g");
        for (const m of src.matchAll(varRe)) localVarNames.push(m[1]);
    }
    const bareNames = [...new Set([...importedNames, ...localVarNames])];
    // Pattern (a): `<MapName.someKey ...>` — a member-expression JSX tag.
    const memberAlternatives = [...mapNames].map((n) => `${n.replace(/[$]/g, "\\$&")}\\.[A-Za-z_$][\\w$]*`);
    const nameAlternatives = [...bareNames.map((n) => n.replace(/[$]/g, "\\$&")), ...memberAlternatives];
    if (!nameAlternatives.length) return { offenders: [], rewritten: src };
    const tagRe = new RegExp(`<(${nameAlternatives.join("|")})\\b((?:[^<>{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*?)(\\/?)>`, "g");
    const offenders = [];
    const rewritten = src.replace(tagRe, (whole, tag, attrs, selfClose, offset) => {
        const { attrs: fixed, changes } = fixAttrs(attrs, { ssr });
        if (!changes.length) return whole;
        offenders.push({ line: lineOf(src, offset), tag, detail: changes.join("; ") });
        const sep = fixed.trim() ? (fixed.startsWith(" ") ? "" : " ") : "";
        return `<${tag}${sep}${fixed.trimEnd()}${selfClose ? " /" : ""}>`;
    });
    return { offenders, rewritten };
}

function findIconSizeOffenders(dir, { apply = false } = {}) {
    const results = [];
    for (const file of walkTsxFiles(dir)) {
        const raw = readFileSync(file, "utf8");
        if (isFileAllowed(raw)) continue;
        const { offenders, rewritten } = scanSource(raw, file);
        if (!offenders.length) continue;
        const rel = path.relative(ROOT, file);
        for (const o of offenders) results.push(`${rel}:${o.line}: <${o.tag}> ${o.detail}`);
        if (apply && rewritten !== raw) writeFileSync(file, rewritten);
    }
    return results;
}

module.exports = { ALLOWED, importedIconNames, scanSource, findIconSizeOffenders };

if (require.main === module) {
    const apply = process.argv.includes("--apply");
    const dir = path.join(ROOT, "src");
    const lines = findIconSizeOffenders(dir, { apply });
    for (const l of lines) console.log(l);
    console.error(`${apply ? "rewrote" : "found"} ${lines.length} icon element(s) with non-rulebook sizes`);
    if (!apply && lines.length) process.exitCode = 1;
}
