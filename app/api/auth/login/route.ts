import { NextRequest, NextResponse } from "next/server";
import { authenticateSingleAccount, createSessionToken, isSecureRequest, readAuthEnvironment, requestHasSameOrigin, safeInternalRedirect, sessionCookieDefinition } from "@/lib/auth/core";
import { clearLoginThrottle, getLoginThrottleState, loginThrottleKey, recordFailedLogin } from "@/lib/auth/rate-limit";
import { LoginRequestError, readLoginCredentials } from "@/lib/auth/request";

const GENERIC_ERROR = "Username atau kata sandi tidak sesuai.";

function failure(status = 401, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 429 && retryAfterSeconds !== undefined) headers["Retry-After"] = String(retryAfterSeconds);
  return NextResponse.json({ ok: false, error: GENERIC_ERROR }, { status, headers });
}

export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) return failure(403);
  const key = loginThrottleKey(request);
  const throttle = getLoginThrottleState(key);
  if (!throttle.allowed) return failure(429, throttle.retryAfterSeconds);

  let credentials: Awaited<ReturnType<typeof readLoginCredentials>>;
  try {
    credentials = await readLoginCredentials(request);
  } catch (error) {
    recordFailedLogin(key);
    return failure(error instanceof LoginRequestError ? error.status : 400);
  }

  const environment = readAuthEnvironment();
  const authenticated = await authenticateSingleAccount(credentials.username, credentials.password, environment);
  if (!authenticated) {
    recordFailedLogin(key);
    return failure();
  }

  clearLoginThrottle(key);
  const redirect = safeInternalRedirect(credentials.next);
  const token = await createSessionToken(environment.username, environment.sessionSecret);
  const cookie = sessionCookieDefinition(isSecureRequest(request));
  const response = credentials.responseType === "redirect"
    ? NextResponse.redirect(new URL(redirect, request.url), 303)
    : NextResponse.json({ ok: true, redirect }, { headers: { "Cache-Control": "no-store" } });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set({ ...cookie, value: token });
  return response;
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}

export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
