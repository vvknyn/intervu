import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { metadata as loginMetadata } from "@/app/login/page";
import { metadata as storiesMetadata } from "@/app/stories/layout";

describe("private pages — noindex metadata", () => {
  it("/login exports noindex, nofollow robots metadata", () => {
    assert.deepEqual(loginMetadata.robots, { index: false, follow: false });
  });

  it("/stories layout exports noindex, nofollow robots metadata", () => {
    assert.deepEqual(storiesMetadata.robots, { index: false, follow: false });
  });
});
