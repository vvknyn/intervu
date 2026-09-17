import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deliverOne } from "@/lib/marketing/deliver";

function noopLog(): void {}

describe("deliverOne", () => {
  it("returns already-sent and never calls send when claim fails", async () => {
    let sendCalls = 0;
    let releaseCalls = 0;
    const outcome = await deliverOne({
      claim: async () => false,
      send: async () => {
        sendCalls++;
      },
      release: async () => {
        releaseCalls++;
      },
      log: noopLog,
    });
    assert.equal(outcome, "already-sent");
    assert.equal(sendCalls, 0);
    assert.equal(releaseCalls, 0);
  });

  it("returns sent and never calls release when claim succeeds and send succeeds", async () => {
    let releaseCalls = 0;
    const outcome = await deliverOne({
      claim: async () => true,
      send: async () => {},
      release: async () => {
        releaseCalls++;
      },
      log: noopLog,
    });
    assert.equal(outcome, "sent");
    assert.equal(releaseCalls, 0);
  });

  it("releases the claim and rethrows the send error when send throws", async () => {
    let releaseCalls = 0;
    const sendErr = new Error("transport exploded");
    await assert.rejects(
      deliverOne({
        claim: async () => true,
        send: async () => {
          throw sendErr;
        },
        release: async () => {
          releaseCalls++;
        },
        log: noopLog,
      }),
      (err: unknown) => err === sendErr,
    );
    assert.equal(releaseCalls, 1);
  });

  it("still surfaces the original send error — not the release error — when release itself throws, and logs the release failure", async () => {
    const sendErr = new Error("transport exploded");
    const releaseErr = new Error("delete failed");
    const logged: string[] = [];
    await assert.rejects(
      deliverOne({
        claim: async () => true,
        send: async () => {
          throw sendErr;
        },
        release: async () => {
          throw releaseErr;
        },
        log: (message) => logged.push(message),
      }),
      (err: unknown) => err === sendErr,
    );
    assert.equal(logged.length, 1);
    assert.match(logged[0], /delete failed/);
  });
});
