import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { readHiddenValue, TerminalSignalError } from "../lib/auth/generator-terminal.mjs";

async function loadTypeScriptModule(path) {
  const moduleSource = await readFile(path, "utf8");
  const output = ts.transpileModule(moduleSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return { source: moduleSource, module: await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`) };
}

const { source, module: auth } = await loadTypeScriptModule("lib/auth/core.ts");
const { module: requestAuth } = await loadTypeScriptModule("lib/auth/request.ts");
const { module: rateLimit } = await loadTypeScriptModule("lib/auth/rate-limit.ts");
const password = "test-password-auth-001";
const username = "mawar-test-admin";
const secret = "test-session-secret-auth-001-is-at-least-32-bytes";
const hash = await auth.createPasswordHash(password, Uint8Array.from({ length: 16 }, (_, index) => index + 1));
const environment = { username, passwordHash: hash, sessionSecret: secret, configured: true };

test("PBKDF2 hash accepts the correct password and rejects an incorrect password", async () => {
  assert.match(hash, /^pbkdf2-sha256\$600000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await auth.authenticateSingleAccount(username, password, environment), true);
  assert.equal(await auth.authenticateSingleAccount(username, "incorrect-password", environment), false);
});

test("incorrect username still follows password verification and is rejected generically", async () => {
  assert.match(source, /Promise\.all\(\[[\s\S]*verifyPassword\(safePassword/);
  assert.equal(await auth.authenticateSingleAccount("unknown-account", password, environment), false);
});

test("malformed password hashes and missing environment fail closed", async () => {
  for (const malformed of ["", "sha256$600000$a$b", "pbkdf2-sha256$1$a$b", "pbkdf2-sha256$600000$bad$bad", `${hash}$extra`]) {
    assert.equal(auth.parsePasswordHash(malformed), null);
    assert.equal(await auth.authenticateSingleAccount(username, password, { ...environment, passwordHash: malformed, configured: false }), false);
  }
  const missing = auth.readAuthEnvironment({});
  assert.equal(missing.configured, false);
  assert.equal(await auth.authenticateSingleAccount(username, password, missing), false);
});

test("valid session verifies while tampering, expiration and wrong secret are rejected", async () => {
  const token = await auth.createSessionToken(username, secret, 1_000);
  const payload = await auth.verifySessionToken(token, secret, 1_001);
  assert.equal(payload.subject, username);
  assert.equal(payload.expiresAt - payload.issuedAt, 3_600);
  const [body, signature] = token.split(".");
  assert.equal(await auth.verifySessionToken(`${body.slice(0, -1)}A.${signature}`, secret, 1_001), null);
  assert.equal(await auth.verifySessionToken(token, secret, 4_600), null);
  assert.equal(await auth.verifySessionToken(token, `${secret}-wrong`, 1_001), null);
});

test("safe redirects allow internal paths and reject external or protocol-relative values", () => {
  assert.equal(auth.safeInternalRedirect("/produksi?season=MT2-2026#view=produksi"), "/produksi?season=MT2-2026#view=produksi");
  for (const value of ["https://evil.example", "//evil.example/path", "\\evil.example", "javascript:alert(1)", " /dashboard", null]) assert.equal(auth.safeInternalRedirect(value), "/");
});

test("production and local cookie definitions enforce the required attributes", () => {
  assert.deepEqual(auth.sessionCookieDefinition(true), { name: "__Host-mawar_session", httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 3_600 });
  assert.deepEqual(auth.sessionCookieDefinition(false), { name: "mawar_session", httpOnly: true, secure: false, sameSite: "strict", path: "/", maxAge: 3_600 });
});

test("origin validation accepts same-origin and rejects missing or cross-origin requests", () => {
  assert.equal(auth.requestHasSameOrigin(new Request("https://mawar.example/api/auth/login", { headers: { origin: "https://mawar.example" } })), true);
  assert.equal(auth.requestHasSameOrigin(new Request("https://mawar.example/api/auth/login", { headers: { origin: "https://evil.example" } })), false);
  assert.equal(auth.requestHasSameOrigin(new Request("https://mawar.example/api/auth/login")), false);
});

function signedToken(payload, signingSecret = secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", signingSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

test("session token rejects non-canonical payload/signature encodings and invalid signature lengths", async () => {
  const token = await auth.createSessionToken(username, secret, 1_000);
  const [body, signature] = token.split("."), alphabet = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"];
  const equivalentSignatureVariants = alphabet.filter(character => character !== signature.at(-1) && Buffer.from(`${signature.slice(0, -1)}${character}`, "base64url").equals(Buffer.from(signature, "base64url")));
  assert.ok(equivalentSignatureVariants.length > 0);
  for (const character of equivalentSignatureVariants) assert.equal(await auth.verifySessionToken(`${body}.${signature.slice(0, -1)}${character}`, secret, 1_001), null);
  const equivalentPayloadVariants = alphabet.filter(character => character !== body.at(-1) && Buffer.from(`${body.slice(0, -1)}${character}`, "base64url").equals(Buffer.from(body, "base64url")));
  for (const character of equivalentPayloadVariants) assert.equal(await auth.verifySessionToken(`${body.slice(0, -1)}${character}.${signature}`, secret, 1_001), null);
  assert.equal(await auth.verifySessionToken(`${body}.${signature.slice(1)}`, secret, 1_001), null);
  assert.equal(await auth.verifySessionToken(`${body}.${signature}=`, secret, 1_001), null);
});

test("session nonce must be canonical, non-zero and exactly eighteen bytes", async () => {
  const base = { version: 1, subject: username, issuedAt: 1_000, expiresAt: 4_600 };
  const validNonce = Buffer.from(Array.from({ length: 18 }, (_, index) => index + 1)).toString("base64url");
  assert.ok(await auth.verifySessionToken(signedToken({ ...base, nonce: validNonce }), secret, 1_001));
  for (const nonce of ["", "short", `${validNonce}A`, `${validNonce}=`, "!".repeat(24), Buffer.alloc(18).toString("base64url"), Buffer.alloc(17, 1).toString("base64url"), Buffer.alloc(19, 1).toString("base64url")]) {
    assert.equal(await auth.verifySessionToken(signedToken({ ...base, nonce }), secret, 1_001), null, `nonce harus ditolak: ${JSON.stringify(nonce)}`);
  }
});

function chunkedRequest(chunks, headers = {}) {
  return new Request("https://mawar.example/api/auth/login", { method: "POST", headers, duplex: "half", body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }) });
}

test("bounded login reader rejects oversized, dishonest length, invalid UTF-8 and unsupported media", async () => {
  const encoder = new TextEncoder(), jsonHeaders = { "content-type": "application/json" };
  await assert.rejects(() => requestAuth.readLoginCredentials(new Request("https://mawar.example/api/auth/login", { method: "POST", headers: { ...jsonHeaders, "content-length": String(requestAuth.AUTH_LOGIN_BODY_LIMIT + 1) }, body: "{}" })), error => error.status === 413);
  await assert.rejects(() => requestAuth.readLoginCredentials(chunkedRequest([new Uint8Array(5_000), new Uint8Array(5_000)], jsonHeaders)), error => error.status === 413);
  await assert.rejects(() => requestAuth.readLoginCredentials(chunkedRequest([new Uint8Array(9_000)], { ...jsonHeaders, "content-length": "1" })), error => error.status === 413);
  for (const length of ["-1", "1.5", "garbage"]) await assert.rejects(() => requestAuth.readLoginCredentials(new Request("https://mawar.example/api/auth/login", { method: "POST", headers: { ...jsonHeaders, "content-length": length }, body: "{}" })), error => error.status === 400);
  await assert.rejects(() => requestAuth.readLoginCredentials(chunkedRequest([Uint8Array.of(0xc3, 0x28)], jsonHeaders)), error => error.status === 400);
  await assert.rejects(() => requestAuth.readLoginCredentials(new Request("https://mawar.example/api/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" })), error => error.status === 415);
  await assert.rejects(() => requestAuth.readLoginCredentials(new Request("https://mawar.example/api/auth/login", { method: "POST", headers: jsonHeaders, body: "{" })), error => error.status === 400);
  const valid = await requestAuth.readLoginCredentials(chunkedRequest([encoder.encode('{"username":"a","password":"b"}')], jsonHeaders));
  assert.deepEqual(valid, { username: "a", password: "b", next: undefined, responseType: "json" });
});

test("rate limiter reports bounded retry state, expires by injected clock and stays size-bounded", () => {
  const limiter = rateLimit.createLoginRateLimiter(3), start = 10_000;
  assert.deepEqual(limiter.state("client", start), { allowed: true, remaining: 5, retryAfterSeconds: 0 });
  for (let attempt = 0; attempt < 5; attempt++) limiter.fail("client", start);
  assert.deepEqual(limiter.state("client", start + 1), { allowed: false, remaining: 0, retryAfterSeconds: 900 });
  assert.equal(limiter.state("client", start + rateLimit.AUTH_LOGIN_WINDOW_MS).allowed, true);
  for (const key of ["a", "b", "c", "d", "e"]) limiter.fail(key, start + rateLimit.AUTH_LOGIN_WINDOW_MS + 1);
  assert.equal(limiter.size(), 3);
  limiter.clear("e");
  assert.equal(limiter.state("e", start + rateLimit.AUTH_LOGIN_WINDOW_MS + 2).allowed, true);
});

test("trusted client identity normalizes IP and ignores untrusted or malformed forwarding", () => {
  const request = headers => new Request("https://mawar.example/api/auth/login", { headers });
  assert.equal(rateLimit.loginThrottleKey(request({ "x-forwarded-for": "203.0.113.8" }), {}), "unknown");
  assert.equal(rateLimit.loginThrottleKey(request({ "x-real-ip": "203.0.113.8" }), {}), "unknown");
  assert.equal(rateLimit.loginThrottleKey(request({ "x-vercel-forwarded-for": "203.000.113.008" }), { VERCEL: "1" }), "203.0.113.8");
  const ipv6 = ["2001:0db8:0:0:0:0:0:1", "2001:db8::1", "2001:DB8::0001"];
  assert.deepEqual(ipv6.map(value => rateLimit.loginThrottleKey(request({ "x-vercel-forwarded-for": value }), { VERCEL: "1" })), ["2001:db8::1", "2001:db8::1", "2001:db8::1"]);
  assert.equal(rateLimit.loginThrottleKey(request({ "x-vercel-forwarded-for": "::ffff:192.0.2.1" }), { VERCEL: "1" }), "::ffff:c000:201");
  for (const value of ["not-an-ip", "attacker-controlled-unbounded-value", "1.2.3.4:80", "host.example", "x".repeat(513), Array(9).fill("1.1.1.1").join(",")]) assert.equal(rateLimit.loginThrottleKey(request({ "x-vercel-forwarded-for": value }), { VERCEL: "1" }), "unknown");
  assert.equal(rateLimit.loginThrottleKey(request({ "x-forwarded-for": "198.51.100.4" }), { MAWAR_AUTH_TRUST_PROXY: "1" }), "198.51.100.4");
});

class FakeTtyInput extends EventEmitter {
  constructor() { super(); this.isTTY = true; this.isRaw = false; this.paused = true; this.rawCalls = []; }
  setRawMode(value) { this.isRaw = value; this.rawCalls.push(value); }
  isPaused() { return this.paused; }
  resume() { this.paused = false; }
  pause() { this.paused = true; }
}

function terminalFixture(outputWrite = value => value) {
  const input = new FakeTtyInput(), signals = new EventEmitter(), writes = [];
  const output = { isTTY: true, write(value) { writes.push(value); return outputWrite(value); } };
  return { input, output, signals, writes };
}

test("hidden credential prompt restores terminal for success, errors and supported signals", async () => {
  const success = terminalFixture(), successPromise = readHiddenValue({ input: success.input, output: success.output, signalEmitter: success.signals });
  success.input.emit("data", Buffer.from("secret-value\r"));
  assert.equal(await successPromise, "secret-value");
  assert.deepEqual(success.input.rawCalls, [true, false]);assert.equal(success.input.paused, true);assert.ok(!success.writes.join("").includes("secret-value"));
  const readFailure = terminalFixture(), failurePromise = readHiddenValue({ input: readFailure.input, output: readFailure.output, signalEmitter: readFailure.signals });
  readFailure.input.emit("error", new Error("read failed"));
  await assert.rejects(failurePromise, /read failed/u);assert.equal(readFailure.input.isRaw, false);assert.equal(readFailure.input.paused, true);
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    const fixture = terminalFixture(), promise = readHiddenValue({ input: fixture.input, output: fixture.output, signalEmitter: fixture.signals });
    fixture.signals.emit(signal);
    await assert.rejects(promise, error => error instanceof TerminalSignalError && error.exitCode === exitCode);assert.equal(fixture.input.isRaw, false);assert.equal(fixture.input.paused, true);assert.equal(fixture.signals.listenerCount(signal), 0);
  }
  const ctrlC = terminalFixture(), ctrlPromise = readHiddenValue({ input: ctrlC.input, output: ctrlC.output, signalEmitter: ctrlC.signals });
  ctrlC.input.emit("data", Buffer.from("hidden\u0003"));await assert.rejects(ctrlPromise, error => error instanceof TerminalSignalError && error.exitCode === 130);assert.equal(ctrlC.input.isRaw, false);
  let writes = 0;const writeFailure = terminalFixture(() => { writes += 1;if (writes === 2) throw new Error("write failed"); });const writePromise = readHiddenValue({ input: writeFailure.input, output: writeFailure.output, signalEmitter: writeFailure.signals });writeFailure.input.emit("data", Buffer.from("value\r"));await assert.rejects(writePromise, /write failed/u);assert.equal(writeFailure.input.isRaw, false);
});
