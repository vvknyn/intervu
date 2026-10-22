import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveUsername } from "../../src/lib/auth/derive-username";

const free = async () => false;
const takenSet = (...names: string[]) => async (u: string) => names.includes(u);

test("plain local part is the username", async () => {
    assert.equal(await deriveUsername("alice@example.com", free), "alice");
});

test("caps, +tag and odd characters are normalised", async () => {
    assert.equal(await deriveUsername("Jo.Smith+jobs@Example.com", free), "jo_smith");
    assert.equal(await deriveUsername("A_B-C@example.com", free), "a_b-c");
});

test("collision gets a numeric suffix, skipping every taken candidate", async () => {
    assert.equal(await deriveUsername("alice@example.com", takenSet("alice")), "alice2");
    assert.equal(await deriveUsername("bob@example.com", takenSet("bob", "bob2", "bob3")), "bob4");
});

test("a too-short or empty local part falls back to a valid base", async () => {
    const u = await deriveUsername("a@example.com", free);
    assert.ok(u.length >= 3, u);
    const v = await deriveUsername("+++@example.com", takenSet("user"));
    assert.ok(v.length >= 3 && v !== "user", v);
});

test("gives up loudly when nothing is free", async () => {
    await assert.rejects(deriveUsername("alice@example.com", async () => true));
});
