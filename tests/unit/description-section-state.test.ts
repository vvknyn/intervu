import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDescriptionSectionState,
  type DescriptionSectionState,
} from "../../src/lib/jobs/description-section-state";

describe("resolveDescriptionSectionState", () => {
  const cases: Array<{
    name: string;
    input: { hydrated: boolean; hasBlocks: boolean; pending: boolean };
    expected: DescriptionSectionState;
  }> = [
    {
      name: "hasBlocks wins over everything, even not-hydrated + pending",
      input: { hydrated: false, hasBlocks: true, pending: true },
      expected: "body",
    },
    {
      name: "teaser body still rendered while the live fill is pending",
      input: { hydrated: true, hasBlocks: true, pending: true },
      expected: "body",
    },
    {
      name: "hydrated with a real body, not pending",
      input: { hydrated: true, hasBlocks: true, pending: false },
      expected: "body",
    },
    {
      name: "not hydrated yet, no blocks, not pending",
      input: { hydrated: false, hasBlocks: false, pending: false },
      expected: "loading",
    },
    {
      name: "not hydrated yet takes priority over pending",
      input: { hydrated: false, hasBlocks: false, pending: true },
      expected: "loading",
    },
    {
      name: "hydrated, empty, and the live fill is still pending",
      input: { hydrated: true, hasBlocks: false, pending: true },
      expected: "pending",
    },
    {
      name: "hydrated, genuinely empty, not pending",
      input: { hydrated: true, hasBlocks: false, pending: false },
      expected: "empty",
    },
  ];

  for (const { name, input, expected } of cases) {
    it(`${name} -> "${expected}"`, () => {
      assert.equal(resolveDescriptionSectionState(input), expected);
    });
  }
});
