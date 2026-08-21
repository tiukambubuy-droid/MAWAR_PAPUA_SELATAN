import { NextRequest, NextResponse } from "next/server";
import { isSecureRequest, readAuthEnvironment, safeInternalRedirect, sessionCookieDefinition, verifySessionToken } from "@/lib/auth/core";

const AUTH_ENDPOINTS = new Set(["/api/auth/login", "/api/auth/logout"]);

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.append("Vary", "Cookie");
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (AUTH_ENDPOINTS.has(pathname)) return noStore(NextResponse.next());

  const environment = readAuthEnvironment();
  const cookie = sessionCookieDefinition(isSecureRequest(request));
  const token = request.cookies.get(cookie.name)?.value;
  const session = environment.configured ? await verifySessionToken(token, environment.sessionSecret) : null;

  if (pathname === "/login") {
    if (session) return noStore(NextResponse.redirect(new URL("/", request.url)));
    return noStore(NextResponse.next());
  }

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", safeInternalRedirect(`${pathname}${request.nextUrl.search}`));
    const response = NextResponse.redirect(loginUrl);
    if (token) response.cookies.set({ ...cookie, value: "", maxAge: 0, expires: new Date(0) });
    return noStore(response);
  }

  return noStore(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|branding/).*)"],
};
