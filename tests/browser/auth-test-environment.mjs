const AUTH_KEYS = ["MAWAR_AUTH_USERNAME", "MAWAR_AUTH_PASSWORD_HASH", "MAWAR_AUTH_SESSION_SECRET"];

export function sanitizeSyntheticEnvironment(source, { username, passwordHash, sessionSecret }) {
  const environment = { ...source };
  for (const key of Object.keys(environment)) if (key.toUpperCase().startsWith("MAWAR_AUTH_")) delete environment[key];
  Object.assign(environment, { MAWAR_AUTH_USERNAME: username, MAWAR_AUTH_PASSWORD_HASH: passwordHash, MAWAR_AUTH_SESSION_SECRET: sessionSecret });
  return environment;
}

export async function createSyntheticAuthEnvironment(authCore) {
  const username = "mawar-browser-admin";
  const password = "browser-auth-001-password";
  const sessionSecret = "mawar-browser-auth-005-session-secret-32-bytes";
  const passwordHash = await authCore.createPasswordHash(password, Uint8Array.from({ length: 16 }, (_, index) => index + 17));
  const environment = sanitizeSyntheticEnvironment(process.env, { username, passwordHash, sessionSecret });
  environment.NODE_ENV = "production";
  return { environment, username, password, passwordHash, sessionSecret };
}

export function syntheticAuthMetadata({ passwordHash, sessionSecret }) {
  return {
    passwordHashCanonical: /^pbkdf2-sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(passwordHash),
    sessionSecretByteLength: Buffer.byteLength(sessionSecret, "utf8"),
    passwordHashContainsBackslash: passwordHash.includes("\\"),
  };
}

export function assertSyntheticAuthEnvironment(environment) {
  for (const key of AUTH_KEYS) {
    if (typeof environment[key] !== "string" || /[\r\n]/u.test(environment[key])) throw new Error(`Environment sintetis tidak valid: ${key}`);
  }
  const metadata = syntheticAuthMetadata({ passwordHash: environment.MAWAR_AUTH_PASSWORD_HASH, sessionSecret: environment.MAWAR_AUTH_SESSION_SECRET });
  if (!metadata.passwordHashCanonical || metadata.passwordHashContainsBackslash) throw new Error("Password hash sintetis bukan format raw canonical");
  return environment;
}
