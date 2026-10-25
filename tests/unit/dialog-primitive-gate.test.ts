import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { EXEMPT_MARKER, findHandRolledOverlays } from "../../scripts/lib/dialog-primitive-gate.mjs";

const ROOT = join(__dirname, "..", "..");
const rules = (src: string) => findHandRolledOverlays(src).map((h: { rule: string }) => h.rule);

test("flags a hand-rolled role=dialog, aria-modal, <dialog> and a direct Radix dialog import", () => {
  assert.deepEqual(rules(`<div role="dialog" className="p-4">`), ["role-dialog"]);
  assert.deepEqual(rules(`<section role='dialog'>`), ["role-dialog"]);
  assert.deepEqual(rules(`<div aria-modal="true">`), ["aria-modal"]);
  assert.deepEqual(rules(`<dialog open>`), ["html-dialog"]);
  assert.deepEqual(rules(`import * as D from "@radix-ui/react-dialog"`), ["radix-dialog-import"]);
  assert.deepEqual(rules(`import { Dialog as D } from "radix-ui"`), ["radix-dialog-import"]);
  assert.deepEqual(rules(`import { Slot, Dialog } from "radix-ui"`), ["radix-dialog-import"]);
  assert.deepEqual(rules(`import { AlertDialog, Switch } from "radix-ui"`), []);
});

test("flags a fixed full-viewport overlay and a fixed centered panel, whatever the other classes", () => {
  assert.deepEqual(rules(`<div className="fixed inset-0 z-50 bg-black/50" />`), ["fixed-full-viewport"]);
  assert.deepEqual(rules(`<div className="z-10 inset-0 flex fixed" />`), ["fixed-full-viewport"]);
  assert.deepEqual(rules(`<div className="fixed top-1/2 left-1/2 -translate-x-1/2" />`), ["fixed-centered"]);
});

test("does not flag look-alikes: selectors, absolute overlays, prose comments, unrelated fixed", () => {
  assert.deepEqual(rules(`target.closest('[role="dialog"]') !== null`), []);
  assert.deepEqual(rules(`<div className="absolute inset-0 z-10" />`), []);
  assert.deepEqual(rules(`<nav className="fixed inset-x-0 bottom-0 z-50" />`), []);
  assert.deepEqual(rules(`<div className="prefixed inset-0" />`), []);
  assert.deepEqual(rules(`// a fixed inset-0 overlay used to live here`), []);
});

test("an on-line or line-above marker WITH a reason exempts; a bare marker does not", () => {
  const reason = "decorative veil, not a dialog";
  assert.deepEqual(rules(`<div className="fixed inset-0" /> // ${EXEMPT_MARKER} ${reason}`), []);
  assert.deepEqual(rules(`// ${EXEMPT_MARKER} ${reason}\n<div className="fixed inset-0" />`), []);
  assert.deepEqual(rules(`{/* ${EXEMPT_MARKER} ${reason} */}\n<div role="dialog" />`), []);
  assert.deepEqual(rules(`<div className="fixed inset-0" /> // ${EXEMPT_MARKER}`), ["fixed-full-viewport"]);
  assert.deepEqual(rules(`<div className="fixed inset-0" /> // ${EXEMPT_MARKER} tbd`), ["fixed-full-viewport"]);
  // a marker two lines up does not carry over
  assert.deepEqual(rules(`// ${EXEMPT_MARKER} ${reason}\nconst x = 1\n<div role="dialog" />`), ["role-dialog"]);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

test("every modal in src/ is built on ui/dialog or ui/sheet (or carries a reasoned exemption)", () => {
  const offenders = sourceFiles(join(ROOT, "src")).flatMap((file) =>
    findHandRolledOverlays(readFileSync(file, "utf8")).map(
      (h: { line: number; rule: string; text: string }) => `${relative(ROOT, file)}:${h.line} [${h.rule}] ${h.text}`,
    ),
  );
  assert.deepEqual(offenders, [], `hand-rolled modal — use ui/dialog or ui/sheet, or mark the line "${EXEMPT_MARKER} <reason>"`);
});
