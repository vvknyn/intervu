import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { DocHeading, collectHeadings, slugifyHeading } from "../../src/components/ui/on-this-page";

test("slugifyHeading derives an anchor from the title", () => {
    assert.equal(slugifyHeading("Cookies & analytics"), "cookies-analytics");
    assert.equal(slugifyHeading("Where data is processed"), "where-data-is-processed");
});

test("collectHeadings finds headings at any depth, in order, honouring an explicit id", () => {
    const tree = React.createElement(
        "div",
        null,
        React.createElement("p", null, "intro"),
        React.createElement(DocHeading, { children: "The service" }),
        React.createElement("section", null, React.createElement(DocHeading, { id: "email", children: "Email notices" })),
    );
    assert.deepEqual(collectHeadings(tree), [
        { id: "the-service", title: "The service" },
        { id: "email", title: "Email notices" },
    ]);
});
