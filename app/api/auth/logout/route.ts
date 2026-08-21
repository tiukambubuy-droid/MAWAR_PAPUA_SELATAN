import { NextRequest, NextResponse } from "next/server";
import { AUTH_DEVELOPMENT_COOKIE, AUTH_SESSION_COOKIE, isSecureRequest, requestHasSameOrigin, sessionCookieDefinition } from "@/lib/auth/core";

export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  const active = sessionCookieDefinition(isSecureRequest(request), 0);
  response.cookies.set({ ...active, value: "", expires: new Date(0) });
  for (const name of [AUTH_SESSION_COOKIE, AUTH_DEVELOPMENT_COOKIE]) {
    if (name !== active.name) response.cookies.set({ ...active, name, secure: name === AUTH_SESSION_COOKIE, value: "", expires: new Date(0) });
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
