export const AUTH_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const AUTH_LOGIN_MAX_ATTEMPTS = 5;
export const AUTH_LOGIN_MAX_ENTRIES = 1_000;

type Attempt = { count: number; expiresAt: number };
export type LoginThrottleState = { allowed: boolean; remaining: number; retryAfterSeconds: number };

function normalizeIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/u.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some(number => number > 255)) return null;
  return numbers.join(".");
}

function canonicalIpv6(groups: number[]) {
  const words = groups.map(group => group.toString(16));
  let bestStart = -1, bestLength = 0;
  for (let index = 0; index < words.length;) {
    if (words[index] !== "0") { index += 1; continue; }
    let end = index;
    while (end < words.length && words[end] === "0") end += 1;
    if (end - index > bestLength && end - index >= 2) { bestStart = index; bestLength = end - index; }
    index = end;
  }
  if (bestStart < 0) return words.join(":");
  const left = words.slice(0, bestStart).join(":"), right = words.slice(bestStart + bestLength).join(":");
  return `${left}::${right}`;
}

function normalizeIpv6(value: string) {
  if (!value.includes(":") || value.includes("%") || value.includes("[") || value.includes("]")) return null;
  let candidate = value.toLowerCase();
  const ipv4Tail = candidate.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  if (ipv4Tail) {
    const ipv4 = normalizeIpv4(ipv4Tail);
    if (!ipv4) return null;
    const octets = ipv4.split(".").map(Number);
    candidate = candidate.slice(0, -ipv4Tail.length) + `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  if ((candidate.match(/::/gu) ?? []).length > 1) return null;
  const compressed = candidate.includes("::"), [leftText, rightText = ""] = candidate.split("::");
  const left = leftText ? leftText.split(":") : [], right = rightText ? rightText.split(":") : [];
  const all = [...left, ...right];
  if (all.some(group => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
  if ((!compressed && all.length !== 8) || (compressed && all.length >= 8)) return null;
  const zeros = compressed ? Array(8 - all.length).fill("0") : [];
  return canonicalIpv6([...left, ...zeros, ...right].map(group => Number.parseInt(group, 16)));
}

export function normalizeClientIp(value: string) {
  if (value.length === 0 || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value) || value !== value.trim()) return null;
  return normalizeIpv4(value) ?? normalizeIpv6(value);
}

function trustedForwardedHeader(request: Request, environment: Record<string, string | undefined>) {
  if (environment.VERCEL === "1") return request.headers.get("x-vercel-forwarded-for");
  if (environment.MAWAR_AUTH_TRUST_PROXY === "1") return request.headers.get("x-forwarded-for");
  return null;
}

export function loginThrottleKey(request: Request, environment: Record<string, string | undefined> = process.env) {
  const header = trustedForwardedHeader(request, environment);
  if (!header || header.length > 512 || /[\u0000-\u001f\u007f]/u.test(header)) return "unknown";
  const candidates = header.split(",");
  if (candidates.length === 0 || candidates.length > 8 || candidates.some(candidate => candidate.trim().length === 0)) return "unknown";
  const normalized = normalizeClientIp(candidates[0].trim());
  return normalized ?? "unknown";
}

export function createLoginRateLimiter(maxEntries = AUTH_LOGIN_MAX_ENTRIES) {
  const attempts = new Map<string, Attempt>();
  const prune = (now: number) => {
    for (const [key, value] of attempts) if (value.expiresAt <= now) attempts.delete(key);
    while (attempts.size >= maxEntries) attempts.delete(attempts.keys().next().value as string);
  };
  return {
    state(key: string, now = Date.now()): LoginThrottleState {
      const current = attempts.get(key);
      if (!current || current.expiresAt <= now) {
        if (current) attempts.delete(key);
        return { allowed: true, remaining: AUTH_LOGIN_MAX_ATTEMPTS, retryAfterSeconds: 0 };
      }
      const retryAfterSeconds = Math.min(AUTH_LOGIN_WINDOW_MS / 1000, Math.max(1, Math.ceil((current.expiresAt - now) / 1000)));
      return { allowed: current.count < AUTH_LOGIN_MAX_ATTEMPTS, remaining: Math.max(0, AUTH_LOGIN_MAX_ATTEMPTS - current.count), retryAfterSeconds };
    },
    fail(key: string, now = Date.now()) {
      prune(now);
      const current = attempts.get(key);
      attempts.set(key, current && current.expiresAt > now ? { ...current, count: current.count + 1 } : { count: 1, expiresAt: now + AUTH_LOGIN_WINDOW_MS });
      return this.state(key, now);
    },
    clear(key: string) { attempts.delete(key); },
    size() { return attempts.size; },
  };
}

const limiter = createLoginRateLimiter();
export const getLoginThrottleState = (key: string, now = Date.now()) => limiter.state(key, now);
export const recordFailedLogin = (key: string, now = Date.now()) => limiter.fail(key, now);
export const clearLoginThrottle = (key: string) => limiter.clear(key);
