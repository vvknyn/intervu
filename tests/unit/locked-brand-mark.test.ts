/**
 * The product mark is the locked soft-card bigger-dot from 1e5d7f11
 * (velai-icon-exports). A dark skeuomorphic tile (bottom arc) replaced
 * these rasters in 8b775697 and failed the Icon gate. These hashes are
 * the restored lock-era bytes — do not regenerate a new mark.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

const LOCKED_SHA256: Record<string, string> = {
    "public/velai-logo.png": "6cced22ebd35e9a35db105fee779458d8f1961d8bae7c562e64a84fb42d79853",
    "public/apple-touch-icon.png": "3b8e5406c7b7a53a9b5eb765a1d8dac56487b88903df99d9c1ec36b42e68d16c",
    "public/icon-192.png": "ef91e6bbd971997951012c0b50d626c21e6be8fb24fabcfd6b7e00e9f21192f9",
    "public/icon-512.png": "fd03b997a0ac8c94808f559199a85c9b9e2a73561c4d734938c8cc123e187f64",
    "public/icons/velai-icon-16.png": "0b544cf70f48bd6d5ad6cffb25e6c991d46567330d91c7fce0f9655ffb02c43f",
    "public/icons/velai-icon-32.png": "7029bea0cfdace271cc74e17b4ae0e744c7b8b7fb53233a1fad28bd61dc09442",
    "public/icons/velai-icon-64.png": "9e829cefb01524cbac67e0ce614c04e1cd2c3c756cfc7e8aad26985f7090a532",
    "public/icons/velai-icon-128.png": "515038d9a7c284d60a975d8896430da4db6db57148d1f1ea5e70ca70904d60a7",
    "public/icons/velai-icon-152.png": "a7cc286cdd6120a4cbee1c9e33f8967547392ba3096cac103287b5b1cf38188d",
    "public/icons/velai-icon-180.png": "9b4ea7b5e8c723b6f5d2feb81e805cfc81c916b390388a22ad89765430ca8ab3",
    "public/icons/velai-icon-256.png": "4b47647ecdef7f41e82b08a3131efe9e17b31995c22783339a8f51e213ea2f3b",
    "public/icons/velai-icon-512.png": "6cced22ebd35e9a35db105fee779458d8f1961d8bae7c562e64a84fb42d79853",
    "public/icons/velai-icon-1024.png": "c0568f756ea774c10679c8defd4b055a3aacf416b587fc24ddecc9e4f4fcdd94",
    "src/app/favicon.ico": "7c46bb00f6f237495d95c79d99c20f625436581c017199d6b2333e3a793d6a0d",
    "src/app/icon.png": "b839777d8eeeeba9622fda068477476f1ade435d9310c7152347022cdeac5c74",
    // Header-only derivative (scripts/generate-header-tile.mjs): the paper tile the Chrome extension
    // shows, its white canvas and shadow made transparent so it sits on the charcoal header.
    "public/velai-tile.png": "0f775d700df3a47771df95b136d2a89c506859317be0f684fe85442fe332bf4a",
    // The same tile at 96px (BrandMark's HEADER_MARK_SMALL_SRC), served through srcSet.
    "public/velai-tile-96.png": "2c86f3ae9e7f1bea685176813fe65c26ce5457880e25dcdb7ec0b359df08f3be",
};

function sha256(rel: string): string {
    return createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex");
}

test("favicon, apple-touch, PWA, and header raster are the locked soft-card bigger-dot", () => {
    for (const [rel, hash] of Object.entries(LOCKED_SHA256)) {
        assert.equal(sha256(rel), hash, `${rel} drifted off the 1e5d7f11 soft-card bigger-dot`);
    }
    // The 512 product raster and the PWA 512 are the same locked file.
    assert.equal(sha256("public/velai-logo.png"), sha256("public/icons/velai-icon-512.png"));
});

test("OG data URI is the locked 128px soft-card, not a second mark", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/brand/locked-mark-data-uri.ts"), "utf8");
    const match = src.match(/base64,([A-Za-z0-9+/=]+)/);
    assert.ok(match, "LOCKED_MARK_DATA_URI must be a png data URI");
    const decoded = Buffer.from(match[1], "base64");
    const icon128 = readFileSync(path.join(ROOT, "public/icons/velai-icon-128.png"));
    assert.ok(decoded.equals(icon128), "OG mark must be public/icons/velai-icon-128.png");
    assert.match(src, /LOCKED_MARK_SRC = '\/velai-logo\.png'/);
});

test("TopBar and OG cards paint the locked raster, not bracket SVG geometry", () => {
    const brand = readFileSync(path.join(ROOT, "src/components/brand/BrandMark.tsx"), "utf8");
    const topBar = readFileSync(path.join(ROOT, "src/components/layout/TopBar.tsx"), "utf8");
    const og = readFileSync(path.join(ROOT, "src/app/opengraph-image.tsx"), "utf8");
    const pageCard = readFileSync(path.join(ROOT, "src/lib/og/page-card.tsx"), "utf8");
    const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
    const manifest = readFileSync(path.join(ROOT, "src/app/manifest.ts"), "utf8");

    assert.match(brand, /src = LOCKED_MARK_SRC/);
    assert.match(brand, /src=\{HEADER_MARK_SRC\}/);
    assert.match(brand, /HEADER_MARK_SRC = "\/velai-tile.png"/);
    assert.doesNotMatch(brand, /<svg/);
    assert.match(topBar, /<BrandLockup/);
    assert.match(og, /src=\{LOCKED_MARK_DATA_URI\}/);
    assert.match(pageCard, /src=\{LOCKED_MARK_DATA_URI\}/);
    assert.match(layout, /apple:\s*"\/apple-touch-icon\.png"/);
    assert.match(manifest, /\/icon-192\.png/);
    assert.match(manifest, /\/icon-512\.png/);
    assert.match(manifest, /\/icons\/velai-icon-180\.png/);
    assert.match(brand, /soft paper card/);
});
