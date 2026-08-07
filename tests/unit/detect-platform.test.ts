import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlatform } from "../../src/lib/detect-platform";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

test("detectPlatform reads macOS", () => {
  assert.equal(detectPlatform(MAC_UA), "mac");
});

test("detectPlatform reads Windows", () => {
  assert.equal(detectPlatform(WINDOWS_UA), "windows");
});

test("detectPlatform reads Linux desktop", () => {
  assert.equal(detectPlatform(LINUX_UA), "linux");
});

test("detectPlatform reads iOS as other, not mac — despite the 'like Mac OS X' substring in its UA", () => {
  assert.equal(detectPlatform(IPHONE_UA), "other");
});

test("detectPlatform reads Android as other, not linux — despite the 'Linux' token in its UA", () => {
  assert.equal(detectPlatform(ANDROID_UA), "other");
});

test("detectPlatform defaults to other on an empty string", () => {
  assert.equal(detectPlatform(""), "other");
});

test("documented quirk: iPadOS desktop-mode Safari reports a bare Macintosh UA and reads as mac", () => {
  assert.equal(detectPlatform(MAC_UA), "mac");
});
