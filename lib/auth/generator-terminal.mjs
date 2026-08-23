const SIGNAL_EXIT_CODES = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

function assertDotenvValue(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error("Nilai environment mengandung karakter kontrol.");
  return value;
}

export function escapeDotenvLocalValue(value) {
  return assertDotenvValue(value).replaceAll("\\", "\\\\").replaceAll("$", "\\$");
}

export function formatAuthEnvironment({ username, passwordHash, sessionSecret }, format = "local") {
  if (format !== "local" && format !== "vercel") throw new Error("Format environment tidak dikenal.");
  const values = format === "local" ? [escapeDotenvLocalValue(username), escapeDotenvLocalValue(passwordHash), escapeDotenvLocalValue(sessionSecret)] : [assertDotenvValue(username), assertDotenvValue(passwordHash), assertDotenvValue(sessionSecret)];
  return [
    `MAWAR_AUTH_USERNAME=${values[0]}`,
    `MAWAR_AUTH_PASSWORD_HASH=${values[1]}`,
    `MAWAR_AUTH_SESSION_SECRET=${values[2]}`,
  ].join("\n");
}

export class TerminalSignalError extends Error {
  constructor(signal) {
    super(`Generator dihentikan oleh ${signal}.`);
    this.name = "TerminalSignalError";
    this.signal = signal;
    this.exitCode = SIGNAL_EXIT_CODES[signal] ?? 1;
  }
}

export async function readHiddenValue({ input, output, signalEmitter = process, prompt = "Kata sandi: " }) {
  if (!input?.isTTY || !output?.isTTY || typeof input.setRawMode !== "function") throw new Error("Terminal interaktif diperlukan.");
  const initialRawMode = Boolean(input.isRaw), initiallyPaused = Boolean(input.isPaused?.());
  const signalHandlers = new Map();
  let onData, onError, cleanupComplete = false;
  const cleanup = () => {
    if (cleanupComplete) return;
    cleanupComplete = true;
    if (onData) input.off("data", onData);
    if (onError) input.off("error", onError);
    for (const [signal, handler] of signalHandlers) signalEmitter.off(signal, handler);
    input.setRawMode(initialRawMode);
    if (initiallyPaused) input.pause(); else input.resume();
  };
  try {
    return await new Promise((resolve, reject) => {
      let value = "", settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        try { output.write("\n"); }
        catch (writeError) { reject(writeError); return; }
        if (error) reject(error); else resolve(value);
      };
      onError = error => finish(error);
      onData = chunk => {
        try {
          for (const character of chunk.toString("utf8")) {
            if (character === "\u0003") { finish(new TerminalSignalError("SIGINT")); return; }
            if (character === "\r" || character === "\n") { finish(); return; }
            if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
            else if (character >= " ") value += character;
          }
        } catch (error) { finish(error); }
      };
      try {
        output.write(prompt);
        for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
          const handler = () => finish(new TerminalSignalError(signal));
          signalHandlers.set(signal, handler);
          signalEmitter.on(signal, handler);
        }
        input.on("error", onError);
        input.on("data", onData);
        input.setRawMode(true);
        input.resume();
      } catch (error) { finish(error); }
    });
  } finally {
    cleanup();
  }
}
