import { test } from "node:test";
import assert from "node:assert/strict";
import {
    COLD_ORIENTATION_DISMISSED_KEY,
    readColdOrientationDismissed,
    writeColdOrientationDismissed,
    subscribeColdOrientation,
} from "../../src/components/jobs/ColdVisitorOrientation";

test("readColdOrientationDismissed returns false by default", () => {
    // In node test environment without browser localStorage, safely returns false
    assert.equal(readColdOrientationDismissed(), false);
});

test("subscribeColdOrientation allows subscribing and unsubscribing without error", () => {
    let fired = false;
    const unsubscribe = subscribeColdOrientation(() => {
        fired = true;
    });
    assert.equal(fired, false);
    writeColdOrientationDismissed();
    assert.equal(fired, true);
    unsubscribe();
});
