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

/** Supabase's AuthError shape: an Error with a stable `.code`. */
function authError(code: string, message = "irrelevant raw message"): Error & { code: string } {
    return Object.assign(new Error(message), { code });
}

check(
    "signup_disabled maps to friendly copy",
    friendlyAuthMessage(authError("signup_disabled"), FB),
    "That sign-in method isn't enabled right now.",
);
check(
    "invalid_credentials maps to invalid-credentials copy",
    friendlyAuthMessage(authError("invalid_credentials"), FB),
    "Invalid username or password",
);
check(
    "over_request_rate_limit maps",
    friendlyAuthMessage(authError("over_request_rate_limit"), FB),
    "Too many attempts — wait a minute and try again.",
);
check(
    "unknown auth code falls back, never raw",
    friendlyAuthMessage(authError("unexpected_failure"), FB),
    FB,
);
check(
    "raw text without a code passes through",
    friendlyAuthMessage(new Error("something exploded"), FB),
    "something exploded",
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
