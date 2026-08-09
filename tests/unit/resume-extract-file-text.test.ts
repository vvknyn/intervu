import { test } from "node:test";
import assert from "node:assert/strict";
import { resumeFileExtension, SUPPORTED_RESUME_FILE_EXTENSIONS } from "../../src/lib/resume/extract-file-text";

/** R1 (2026-08-09 user report): the account "Resume" section's file-type
 *  validation for its upload path — pure, no File/Blob I/O involved. */

test("recognizes every supported extension, case-insensitively", () => {
  for (const ext of SUPPORTED_RESUME_FILE_EXTENSIONS) {
    assert.equal(resumeFileExtension(`resume.${ext}`), ext);
    assert.equal(resumeFileExtension(`resume.${ext.toUpperCase()}`), ext);
  }
});

test("rejects an unsupported extension (e.g. .png) rather than guessing", () => {
  assert.equal(resumeFileExtension("resume.png"), null);
});

test("rejects a filename with no extension at all", () => {
  assert.equal(resumeFileExtension("resume"), null);
});

test("uses the LAST extension for a multi-dot filename", () => {
  assert.equal(resumeFileExtension("my.resume.v2.pdf"), "pdf");
});
