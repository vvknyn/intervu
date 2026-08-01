import { friendlyAuthMessage } from "../../src/lib/firebase/auth-errors";

let failures = 0;
function check(name: string, actual: string, expected: string) {
    if (actual === expected) {
        console.log(`  ok - ${name}`);
    } else {
        failures++;
        console.error(`  FAIL - ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
    }
}

const FB = "Sign-in failed — try again in a moment.";

check(
    "operation-not-allowed maps to friendly copy",
    friendlyAuthMessage(new Error("Firebase: Error (auth/operation-not-allowed)."), FB),
    "That sign-in method isn't enabled right now.",
);
check(
    "wrong-password maps to invalid-credentials copy",
    friendlyAuthMessage(new Error("Firebase: Error (auth/wrong-password)."), FB),
    "Invalid username or password",
);
check(
    "too-many-requests maps",
    friendlyAuthMessage(new Error("Firebase: Error (auth/too-many-requests)."), FB),
    "Too many attempts — wait a minute and try again.",
);
check(
    "unknown auth code falls back, never raw",
    friendlyAuthMessage(new Error("Firebase: Error (auth/internal-error)."), FB),
    FB,
);
check(
    "raw Firebase text without code falls back",
    friendlyAuthMessage(new Error("Firebase: something exploded"), FB),
    FB,
);
check(
    "app-thrown message passes through",
    friendlyAuthMessage(new Error("Username is already taken"), FB),
    "Username is already taken",
);
check("non-error input falls back", friendlyAuthMessage(undefined, FB), FB);

if (failures > 0) {
    console.error(`${failures} failure(s)`);
    process.exit(1);
}
console.log("auth-errors: all tests passed");
