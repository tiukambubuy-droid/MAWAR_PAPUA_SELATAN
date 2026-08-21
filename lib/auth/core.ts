export const AUTH_SESSION_SECONDS = 60 * 60;
export const AUTH_PBKDF2_ITERATIONS = 600_000;
export const AUTH_USERNAME_MAX_LENGTH = 128;
export const AUTH_PASSWORD_MAX_LENGTH = 256;
export const AUTH_SESSION_COOKIE = "__Host-mawar_session";
export const AUTH_DEVELOPMENT_COOKIE = "mawar_session";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export type AuthEnvironment = {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  configured: boolean;
};

export type SessionPayload = {
  version: 1;
  subject: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type SessionCookieDefinition = {
  name: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge: number;
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url value");
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  const decoded = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytesToBase64Url(decoded) !== value) throw new Error("Non-canonical base64url value");
  return decoded;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

function isValidUsername(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= AUTH_USERNAME_MAX_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= AUTH_PASSWORD_MAX_LENGTH;
}

export function parsePasswordHash(value: string) {
  const [algorithm, iterationsText, saltText, hashText, extra] = value.split("$");
  if (extra !== undefined || algorithm !== "pbkdf2-sha256" || iterationsText !== String(AUTH_PBKDF2_ITERATIONS)) return null;
  try {
    const salt = base64UrlToBytes(saltText ?? "");
    const hash = base64UrlToBytes(hashText ?? "");
    if (salt.length < 16 || salt.length > 64 || hash.length !== 32) return null;
    return { iterations: AUTH_PBKDF2_ITERATIONS, salt, hash };
  } catch {
    return null;
  }
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number, length = 32) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, length * 8));
}

export async function createPasswordHash(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  if (!isValidPassword(password)) throw new Error(`Password harus 1-${AUTH_PASSWORD_MAX_LENGTH} karakter`);
  if (salt.length < 16) throw new Error("Salt minimal 16 byte");
  const derived = await derivePassword(password, salt, AUTH_PBKDF2_ITERATIONS, 32);
  return `pbkdf2-sha256$${AUTH_PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed || !isValidPassword(password)) return false;
  const derived = await derivePassword(password, parsed.salt, parsed.iterations, parsed.hash.length);
  return constantTimeEqual(derived, parsed.hash);
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function readAuthEnvironment(environment: Record<string, string | undefined> = process.env): AuthEnvironment {
  const username = environment.MAWAR_AUTH_USERNAME ?? "";
  const passwordHash = environment.MAWAR_AUTH_PASSWORD_HASH ?? "";
  const sessionSecret = environment.MAWAR_AUTH_SESSION_SECRET ?? "";
  const configured = isValidUsername(username) && parsePasswordHash(passwordHash) !== null && encoder.encode(sessionSecret).length >= 32;
  return { username, passwordHash, sessionSecret, configured };
}

export async function authenticateSingleAccount(username: unknown, password: unknown, environment = readAuthEnvironment()) {
  const safeUsername = typeof username === "string" && username.length <= AUTH_USERNAME_MAX_LENGTH ? username : "";
  const safePassword = typeof password === "string" && password.length <= AUTH_PASSWORD_MAX_LENGTH ? password : "";
  const hashToVerify = parsePasswordHash(environment.passwordHash) ? environment.passwordHash : DUMMY_PASSWORD_HASH;
  const [providedUsername, configuredUsername, passwordMatches] = await Promise.all([
    digest(safeUsername),
    digest(environment.username),
    verifyPassword(safePassword || "invalid-password", hashToVerify),
  ]);
  const usernameMatches = constantTimeEqual(providedUsername, configuredUsername);
  return environment.configured && isValidUsername(username) && isValidPassword(password) && usernameMatches && passwordMatches;
}

async function importHmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function createSessionToken(subject: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!isValidUsername(subject) || encoder.encode(secret).length < 32) throw new Error("Konfigurasi session tidak valid");
  const payload: SessionPayload = {
    version: 1,
    subject,
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + AUTH_SESSION_SECONDS,
    nonce: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18))),
  };
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(encodedPayload)));
  return `${encodedPayload}.${bytesToBase64Url(signature)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || encoder.encode(secret).length < 32 || token.length > 4096) return null;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || encodedPayload.length > 2048 || encodedSignature?.length !== 43 || extra !== undefined) return null;
  try {
    const provided = base64UrlToBytes(encodedSignature);
    if (provided.length !== 32) return null;
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(encodedPayload)));
    if (!constantTimeEqual(expected, provided)) return null;
    const payloadBytes = base64UrlToBytes(encodedPayload);
    const payload = JSON.parse(decoder.decode(payloadBytes)) as Partial<SessionPayload>;
    if (payload.version !== 1 || !isValidUsername(payload.subject) || !Number.isInteger(payload.issuedAt) || !Number.isInteger(payload.expiresAt) || typeof payload.nonce !== "string") return null;
    if (payload.nonce.length !== 24) return null;
    const nonce = base64UrlToBytes(payload.nonce);
    if (nonce.length !== 18 || nonce.every(byte => byte === 0)) return null;
    if ((payload.issuedAt as number) > nowSeconds + 30 || (payload.expiresAt as number) <= nowSeconds || (payload.expiresAt as number) - (payload.issuedAt as number) !== AUTH_SESSION_SECONDS) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function safeInternalRedirect(value: unknown, fallback = "/") {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || value !== value.trim()) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return fallback;
  try {
    const parsed = new URL(value, "https://mawar.internal");
    if (parsed.origin !== "https://mawar.internal") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function isSecureRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded ? forwarded === "https" : new URL(request.url).protocol === "https:";
}

export function sessionCookieDefinition(secure: boolean, maxAge = AUTH_SESSION_SECONDS): SessionCookieDefinition {
  return { name: secure ? AUTH_SESSION_COOKIE : AUTH_DEVELOPMENT_COOKIE, httpOnly: true, secure, sameSite: "strict", path: "/", maxAge };
}

export function requestHasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const expectedOrigin = forwardedHost ? `${forwardedProto || requestUrl.protocol.slice(0, -1)}://${forwardedHost}` : requestUrl.origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}
