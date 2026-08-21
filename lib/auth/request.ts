export const AUTH_LOGIN_BODY_LIMIT = 8 * 1024;

export class LoginRequestError extends Error {
  constructor(public readonly status: 400 | 413 | 415) {
    super("Invalid login request");
    this.name = "LoginRequestError";
  }
}

function declaredBodyLength(request: Request) {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^(0|[1-9]\d*)$/u.test(value)) throw new LoginRequestError(400);
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new LoginRequestError(413);
  if (length > AUTH_LOGIN_BODY_LIMIT) throw new LoginRequestError(413);
  return length;
}

export async function readBoundedRequestBody(request: Request) {
  declaredBodyLength(request);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > AUTH_LOGIN_BODY_LIMIT) {
        await reader.cancel("Login body exceeds limit").catch(() => undefined);
        throw new LoginRequestError(413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof LoginRequestError) throw error;
    throw new LoginRequestError(400);
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function decodeUtf8(body: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new LoginRequestError(400);
  }
}

export async function readLoginCredentials(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/x-www-form-urlencoded") throw new LoginRequestError(415);
  const text = decodeUtf8(await readBoundedRequestBody(request));
  if (contentType === "application/json") {
    try {
      const body: unknown = JSON.parse(text);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new LoginRequestError(400);
      const record = body as Record<string, unknown>;
      return { username: record.username, password: record.password, next: record.next, responseType: "json" as const };
    } catch (error) {
      if (error instanceof LoginRequestError) throw error;
      throw new LoginRequestError(400);
    }
  }
  const form = new URLSearchParams(text);
  return { username: form.get("username"), password: form.get("password"), next: form.get("next"), responseType: "redirect" as const };
}
