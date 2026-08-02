import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, contactMessageSchema, isHoneypotTripped } from "../../src/lib/validation";

test("valid contact message with name passes", () => {
    const result = validate(contactMessageSchema, {
        name: "Ada",
        email: "ada@example.com",
        message: "I have a question about a listing.",
    });
    assert.equal(result.ok, true);
});

test("valid contact message with name omitted still passes", () => {
    const result = validate(contactMessageSchema, {
        email: "ada@example.com",
        message: "I have a question about a listing.",
    });
    assert.equal(result.ok, true);
});

test("invalid email shape fails", () => {
    const result = validate(contactMessageSchema, {
        email: "not-an-email",
        message: "I have a question about a listing.",
    });
    assert.equal(result.ok, false);
});

test("message under 10 characters fails", () => {
    const result = validate(contactMessageSchema, {
        email: "ada@example.com",
        message: "hi",
    });
    assert.equal(result.ok, false);
});

test("isHoneypotTripped is false for empty, undefined, and whitespace-only", () => {
    assert.equal(isHoneypotTripped(""), false);
    assert.equal(isHoneypotTripped(undefined), false);
    assert.equal(isHoneypotTripped("   "), false);
});

test("isHoneypotTripped is true when the field was filled", () => {
    assert.equal(isHoneypotTripped("http://spam.example"), true);
});
