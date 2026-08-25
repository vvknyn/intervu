import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFirebaseScryptHash,
  decodeBase64Any,
  splitDisplayName,
  toWorkosUserPayload,
  type FirebaseHashConfig,
} from "../../src/lib/auth/firebase-to-workos";

/**
 * A byte string whose base64 needs BOTH of the characters the two alphabets
 * disagree on (`+`/`-` and `/`/`_`), so the standard and URL encodings of the
 * same bytes are guaranteed to differ as text. Every alphabet assertion below
 * first proves that difference exists — a test that compared two identical
 * strings would pass against the exact bug it is meant to catch.
 */
const MIXED = Buffer.from([0xfb, 0xef, 0xbe, 0x03, 0xff, 0xe0]);
const STD = MIXED.toString("base64");
const URL_SAFE = STD.replace(/\+/g, "-").replace(/\//g, "_");

const CONFIG: FirebaseHashConfig = {
  signerKey: Buffer.from("signer-key-bytes").toString("base64"),
  saltSeparator: "Bw==",
  rounds: 8,
  memoryCost: 14,
};

test("the two base64 alphabets really do differ on this fixture", () => {
  // Guard for every alphabet test below: if this ever stops holding, those
  // tests silently stop testing anything.
  assert.notEqual(STD, URL_SAFE);
  assert.match(STD, /[+/]/);
  assert.match(URL_SAFE, /[-_]/);
});

test("decodeBase64Any yields the same bytes from either alphabet", () => {
  assert.deepEqual(decodeBase64Any(STD), MIXED);
  assert.deepEqual(decodeBase64Any(URL_SAFE), MIXED);
});

test("buildFirebaseScryptHash is alphabet-agnostic", () => {
  // The bug that failed 9 of 9 imports with `invalid_password_hash`: the
  // Admin SDK hands back base64url, and treating it as text carried the URL
  // characters straight into the PHC string, where they decode to different
  // bytes. Same credential, either encoding, one output.
  const fromUrl = buildFirebaseScryptHash(
    { passwordHash: URL_SAFE, passwordSalt: URL_SAFE },
    CONFIG,
  );
  const fromStd = buildFirebaseScryptHash(
    { passwordHash: STD, passwordSalt: STD },
    CONFIG,
  );
  assert.equal(fromUrl, fromStd);
  assert.ok(fromUrl);
});

test("buildFirebaseScryptHash emits the PHC shape WorkOS accepts", () => {
  const phc = buildFirebaseScryptHash(
    { passwordHash: STD, passwordSalt: STD },
    CONFIG,
  )!;

  // $firebase-scrypt$v=1$<params>$<salt>$<hash> — the leading $ makes the
  // first split segment empty, so a well-formed string has six.
  const segments = phc.split("$");
  assert.equal(segments.length, 6);
  assert.equal(segments[0], "");
  assert.equal(segments[1], "firebase-scrypt");
  assert.equal(segments[2], "v=1");
  assert.equal(
    segments[3],
    `r=8,m=14,ss=Bw,sk=${CONFIG.signerKey.replace(/=+$/, "")}`,
  );

  // PHC forbids the '=' padding character in its b64 fields.
  assert.doesNotMatch(phc, /=[^0-9a-zA-Z+/,$]/);
  assert.ok(!segments[4].includes("="));
  assert.ok(!segments[5].includes("="));

  // The salt and hash must survive the round trip as bytes.
  assert.deepEqual(Buffer.from(segments[4], "base64"), MIXED);
  assert.deepEqual(Buffer.from(segments[5], "base64"), MIXED);
});

test("buildFirebaseScryptHash refuses a half-present credential", () => {
  // A hash without its salt cannot be verified. Emitting one anyway would
  // lock the account out silently, which is worse than having no password.
  assert.equal(buildFirebaseScryptHash({ passwordHash: STD }, CONFIG), null);
  assert.equal(buildFirebaseScryptHash({ passwordSalt: STD }, CONFIG), null);
  assert.equal(buildFirebaseScryptHash({}, CONFIG), null);
});

test("splitDisplayName keeps multi-word family names whole", () => {
  assert.deepEqual(splitDisplayName("Ada Lovelace"), {
    first: "Ada",
    last: "Lovelace",
  });
  assert.deepEqual(splitDisplayName("Ada Lovelace King"), {
    first: "Ada",
    last: "Lovelace King",
  });
  // One token is a first name; inventing a surname would be inventing a fact
  // about a person.
  assert.deepEqual(splitDisplayName("Ada"), { first: "Ada" });
  assert.deepEqual(splitDisplayName("  Ada   Lovelace  "), {
    first: "Ada",
    last: "Lovelace",
  });
  assert.deepEqual(splitDisplayName(""), {});
  assert.deepEqual(splitDisplayName(undefined), {});
});

test("toWorkosUserPayload carries the Firebase uid as external_id", () => {
  // Every Firestore document is keyed by this uid. If it did not travel, the
  // user would arrive in WorkOS with an empty account.
  const payload = toWorkosUserPayload(
    {
      uid: "MR3iXRtIpANFdTrzMosBfOMl4lU2",
      email: "  Ada@Example.COM ",
      emailVerified: true,
      displayName: "Ada Lovelace",
      photoURL: "https://example.com/a.png",
      passwordHash: URL_SAFE,
      passwordSalt: URL_SAFE,
    },
    CONFIG,
  )!;

  assert.equal(payload.external_id, "MR3iXRtIpANFdTrzMosBfOMl4lU2");
  assert.equal(payload.metadata.firebase_uid, "MR3iXRtIpANFdTrzMosBfOMl4lU2");
  assert.equal(payload.metadata.photo_url, "https://example.com/a.png");
  assert.equal(payload.email, "ada@example.com");
  assert.equal(payload.email_verified, true);
  assert.equal(payload.first_name, "Ada");
  assert.equal(payload.last_name, "Lovelace");
  assert.equal(payload.password_hash_type, "firebase-scrypt");
  assert.ok(payload.password_hash?.startsWith("$firebase-scrypt$v=1$"));
});

test("toWorkosUserPayload creates a Google-only user without credentials", () => {
  // Nine of the eighteen accounts have no password because they sign in
  // through Google. Holding them back would strand them in Firebase.
  const payload = toWorkosUserPayload(
    { uid: "google-uid", email: "g@example.com", emailVerified: true },
    CONFIG,
  )!;

  assert.equal(payload.external_id, "google-uid");
  assert.equal(payload.password_hash, undefined);
  assert.equal(payload.password_hash_type, undefined);
  assert.equal(payload.first_name, undefined);
});

test("toWorkosUserPayload skips a user with no email", () => {
  // WorkOS identifies users by email; there is nothing for this record to
  // become. Callers report these rather than dropping them silently.
  assert.equal(toWorkosUserPayload({ uid: "phone-only" }, CONFIG), null);
  assert.equal(toWorkosUserPayload({ uid: "blank", email: "" }, CONFIG), null);
});

/**
 * The `apps` tag is what keeps intervu's users distinguishable from subspace's
 * now that a single WorkOS environment serves both products.
 */
test("a Firebase user is tagged intervu, and the tag merges rather than replaces", () => {
  const fresh = toWorkosUserPayload({ uid: "u1", email: "a@b.com" }, CONFIG)!;
  assert.equal(fresh.metadata.apps, "intervu");

  // The case that matters is the OTHER one: a person already known to
  // subspace. Assigning here instead of merging would evict them from
  // subspace while their login kept working — a silent loss, not an error.
  const both = toWorkosUserPayload({ uid: "u2", email: "b@c.com" }, CONFIG, "subspace")!;
  assert.equal(both.metadata.apps, "intervu,subspace");

  // Re-running the migration must converge, not accumulate duplicates.
  const again = toWorkosUserPayload(
    { uid: "u3", email: "c@d.com" },
    CONFIG,
    "intervu,subspace",
  )!;
  assert.equal(again.metadata.apps, "intervu,subspace");
});
