import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * deploy/db-box/preflight-telemetry-connectivity.sh classifies a psql
 * connection attempt's exit status + stderr into a verdict
 * (admitted / not-admitted / trust-auth / other) via its
 * `classify_psql_error` shell function. That function takes no role name
 * and does no I/O of its own, so it can be driven directly via `bash -c`
 * against literal server replies — no database, no network, no psql binary
 * required.
 *
 * The four cases below are the ones the script's own header documents.
 * telemetry_pg / "no pg_hba.conf entry" is the exact 2026-09-04 bug that
 * motivated this script; the other three (a role accepting the invalid
 * password, a timeout, and a differently-worded network failure) prove the
 * classifier is a general mapping over exit status + message shape, not a
 * check keyed to that one role or that one string.
 */

const SCRIPT = path.join(process.cwd(), "deploy", "db-box", "preflight-telemetry-connectivity.sh");

/**
 * Sources the script (which only defines functions/vars when sourced — see
 * its final `if [[ "${BASH_SOURCE[0]}" == "${0}" ]]` guard) and calls
 * classify_psql_error with the given args. The script path is interpolated
 * into the command string itself, rather than passed as bash -c's `$0`,
 * because `bash -c 'cmd' arg0 ...` sets the *parent* shell's $0 to arg0 —
 * passing SCRIPT there would make BASH_SOURCE[0] equal $0 and trip the
 * script's own direct-execution guard, running its network-touching main()
 * as a side effect of sourcing it for this test.
 */
function classify(exitStatus: number, stderrText: string): string {
    return execFileSync(
        "bash",
        ["-c", `source "${SCRIPT}"; classify_psql_error "$1" "$2"`, "_", String(exitStatus), stderrText],
        { encoding: "utf8" }
    ).trim();
}

describe("classify_psql_error", () => {
    it("classifies the exact 2026-09-04 gap: no pg_hba.conf entry for telemetry_pg", () => {
        const stderrText =
            'psql: error: connection to server at "169.58.140.49", port 5432 failed: FATAL:  no pg_hba.conf entry for host "194.163.147.154", user "telemetry_pg", database "postgres", SSL encryption';
        assert.equal(classify(2, stderrText), "not-admitted");
    });

    it("classifies a correctly admitted role — password rejected, everything else fine — as admitted (PASS)", () => {
        const stderrText =
            'psql: error: connection to server at "169.58.140.49", port 5432 failed: FATAL:  password authentication failed for user "telemetry_pg"';
        assert.equal(classify(2, stderrText), "admitted");
    });

    it("classifies a role other than telemetry_pg the same way, on exit status + message alone", () => {
        // Proves the classifier does not key on a role name at all — it
        // never sees one. agent_pg and pipeline hit the exact same function.
        const stderrText =
            'psql: error: connection to server at "169.58.140.49", port 5432 failed: FATAL:  password authentication failed for user "pipeline"';
        assert.equal(classify(2, stderrText), "admitted");
    });

    it("classifies a successful connection (exit 0) as trust-auth — a FAIL, and a worse finding than a missing pg_hba rule", () => {
        assert.equal(classify(0, ""), "trust-auth");
    });

    it("classifies a timeout as other, not as either known string", () => {
        const stderrText = 'psql: error: connection to server at "169.58.140.49", port 5432 failed: timeout expired';
        assert.equal(classify(2, stderrText), "other");
    });

    it("classifies an unrelated network failure (connection refused) as other, proving it is a catch-all and not just 'not the first two strings'", () => {
        const stderrText =
            'psql: error: connection to server at "169.58.140.49", port 5432 failed: Connection refused\n\tIs the server running on that host and accepting TCP/IP connections?';
        assert.equal(classify(2, stderrText), "other");
    });
});
