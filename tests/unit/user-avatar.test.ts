import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getAvatarInitials, UserAvatar } from "../../src/components/ui/user-avatar";

/**
 * Signed-in header identity trigger (2026-09-03): the "Account" text label
 * was replaced by a photo-or-initials avatar. This proves the initials
 * decision for every input shape (2-word name, 1-word name, email-only) and
 * that a picture short-circuits initials entirely — a case other than the
 * "Vivek Narayanan" name that motivated the change.
 */
describe("getAvatarInitials: name -> email -> \"\" fallback ladder", () => {
    it("two-or-more-word name -> first letter of the first two words", () => {
        assert.equal(getAvatarInitials("Vivek Narayanan"), "VN");
        assert.equal(getAvatarInitials("Ada Lovelace Byron"), "AL");
    });

    it("single-word name -> first two letters of that word", () => {
        assert.equal(getAvatarInitials("Ada"), "AD");
    });

    it("no usable name -> first two letters of the email local part", () => {
        assert.equal(getAvatarInitials(undefined, "priya@example.com"), "PR");
        assert.equal(getAvatarInitials("", "priya@example.com"), "PR");
        assert.equal(getAvatarInitials("   ", "priya@example.com"), "PR");
    });

    it("nothing to go on -> empty string, not a crash", () => {
        assert.equal(getAvatarInitials(), "");
        assert.equal(getAvatarInitials(undefined, undefined), "");
    });
});

describe("UserAvatar: picture short-circuits initials", () => {
    it("pictureUrl set -> renders an <img>, no initials text", () => {
        const html = renderToStaticMarkup(
            React.createElement(UserAvatar, { name: "Vivek Narayanan", pictureUrl: "/velai-logo.png" }),
        );
        assert.match(html, /<img[^>]*src="\/velai-logo\.png"/);
        assert.doesNotMatch(html, />VN</);
    });

    it("no pictureUrl -> renders the initials text, no <img>", () => {
        const html = renderToStaticMarkup(React.createElement(UserAvatar, { name: "Vivek Narayanan" }));
        assert.doesNotMatch(html, /<img/);
        assert.match(html, />VN</);
    });

    it("email-only fallback renders through the real component", () => {
        const html = renderToStaticMarkup(React.createElement(UserAvatar, { email: "priya@example.com" }));
        assert.match(html, />PR</);
    });
});
