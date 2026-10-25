/**
 * scripts/start-web.mjs proxy log lines, end to end: the real entrypoint runs
 * beside a fake server.js (copied next to it) that answers slowly or destroys
 * the socket, and the test reads what the proxy logs.
 */
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const FAKE_SERVER = `
import http from "node:http";
http.createServer((req, res) => {
    if (req.url.startsWith("/reset")) return req.socket.destroy();
    if (req.url.startsWith("/slow")) return void setTimeout(() => res.end("late"), 3000);
    res.end("ok");
}).listen(Number(process.env.PORT), "127.0.0.1");
`;

let dir: string;
let proxy: ChildProcess;
let log = "";
let port: number;

const freePort = () =>
    new Promise<number>((resolve) => {
        const s = net.createServer().listen(0, "127.0.0.1", () => {
            const p = (s.address() as net.AddressInfo).port;
            s.close(() => resolve(p));
        });
    });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = (p: string) =>
    new Promise<number>((resolve) => http.get({ host: "127.0.0.1", port, path: p }, (r) => { r.resume(); resolve(r.statusCode ?? 0); }).on("error", () => resolve(0)));

before(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "start-web-"));
    for (const f of ["start-web.mjs", "web-pool.mjs", "event-loop-delay.mjs"]) copyFileSync(path.join("scripts", f), path.join(dir, f));
    writeFileSync(path.join(dir, "server.js"), FAKE_SERVER);
    port = await freePort();
    // Workers sit on port+1.. and the public port is port; a free block is assumed beside it.
    proxy = spawn(process.execPath, [path.join(dir, "start-web.mjs")], { env: { ...process.env, PORT: String(port), WEB_CONCURRENCY: "2", HOSTNAME: "127.0.0.1" } });
    proxy.stdout?.on("data", (d) => { log += d; });
    proxy.stderr?.on("data", (d) => { log += d; });
    for (let i = 0; i < 100 && !/listening on/.test(log); i++) await wait(100);
    assert.match(log, /listening on/, log);
});

after(() => {
    // SIGTERM: the proxy stops its workers; SIGKILL would orphan them and hold the pipes open.
    proxy?.kill("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
});

test("a visitor who leaves a slow request logs visitor_left, not upstream_error, and the proxy keeps serving", async () => {
    const req = http.get({ host: "127.0.0.1", port, path: "/slow/x?email=a@b.c" });
    req.on("error", () => {});
    await wait(300);
    req.destroy();
    await wait(500);
    assert.match(log, /\[proxy\] visitor_left port=\d+ GET \/slow\/x \d+ms/);
    assert.doesNotMatch(log, /upstream_error/);
    assert.equal(log.includes("a@b.c"), false);
    assert.equal(await get("/fine"), 200);
});

test("a worker that resets the socket still logs upstream_error and answers 502", async () => {
    assert.equal(await get("/reset/y"), 502);
    assert.match(log, /\[proxy\] upstream_error code=ECONNRESET port=\d+ GET \/reset\/y \d+ms/);
});
