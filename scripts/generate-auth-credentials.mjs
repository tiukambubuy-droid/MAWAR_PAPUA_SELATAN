import { readFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import ts from "typescript";
import { formatAuthEnvironment, readHiddenValue, TerminalSignalError } from "../lib/auth/generator-terminal.mjs";

if (process.argv.length > 2) throw new Error("Credential tidak boleh diberikan melalui command-line argument.");
if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") throw new Error("Jalankan generator ini pada terminal interaktif.");

const source = await readFile(new URL("../lib/auth/core.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const auth = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

try {
  const readline = createInterface({ input: stdin, output: stdout });
  let username;
  try { username = (await readline.question("Username: ")).trim(); }
  finally { readline.close(); }
  if (!username || username.length > auth.AUTH_USERNAME_MAX_LENGTH) throw new Error("Username tidak valid.");
  const password = await readHiddenValue({ input: stdin, output: stdout });
  const passwordHash = await auth.createPasswordHash(password);
  const sessionSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const credential = { username, passwordHash, sessionSecret };
  stdout.write("\n# Next.js .env.local (gunakan \\$ untuk karakter $; jangan salin backslash ini ke Vercel)\n");
  stdout.write(`${formatAuthEnvironment(credential, "local")}\n`);
  stdout.write("\n# Vercel Production / direct environment (gunakan $ biasa; jangan simpan password plaintext pada file environment)\n");
  stdout.write(`${formatAuthEnvironment(credential, "vercel")}\n`);
} catch (error) {
  if (error instanceof TerminalSignalError) process.exitCode = error.exitCode;
  else throw error;
}
