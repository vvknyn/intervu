import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMessageTime } from "../../src/components/marketing/whatsapp-message-time";

test("deriveMessageTime returns the base timestamp verbatim at index 0", () => {
    assert.equal(deriveMessageTime("8:10am", 0), "8:10 AM");
});

test("deriveMessageTime adds one minute per index", () => {
    assert.equal(deriveMessageTime("8:10am", 6), "8:16 AM");
});

test("deriveMessageTime rolls over the hour", () => {
    assert.equal(deriveMessageTime("8:55am", 10), "9:05 AM");
});

test("deriveMessageTime rolls from am to pm across noon", () => {
    assert.equal(deriveMessageTime("11:58am", 5), "12:03 PM");
});

test("deriveMessageTime throws on an unparseable base timestamp", () => {
    assert.throws(() => deriveMessageTime("not-a-time", 0));
});
