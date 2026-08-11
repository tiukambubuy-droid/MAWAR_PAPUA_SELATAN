import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, parse, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export const BROWSER_PROFILE_PREFIX = "mawar-browser-test-";
const profileOwnership = new WeakMap();

export class BrowserProfileCleanupError extends Error {
  constructor(code, message) { super(message); this.name = "BrowserProfileCleanupError"; this.code = code; }
}

const comparablePath = path => process.platform === "win32" ? normalize(path).toLowerCase() : normalize(path);
const samePath = (left, right) => comparablePath(left) === comparablePath(right);

export function validateBrowserTemporaryRoot(candidateRoot = tmpdir()) {
  if (typeof candidateRoot !== "string" || !isAbsolute(candidateRoot)) throw new BrowserProfileCleanupError("INVALID_TEMP_ROOT", "Temporary root harus berupa path absolut");
  const canonicalTemp = normalize(realpathSync(resolve(tmpdir())));
  let normalizedCandidate;
  try { normalizedCandidate = normalize(realpathSync(resolve(candidateRoot))); }
  catch { throw new BrowserProfileCleanupError("INVALID_TEMP_ROOT", "Temporary root harus sudah tersedia dan dapat di-resolve"); }
  const relation = relative(canonicalTemp, normalizedCandidate);
  if (relation && (isAbsolute(relation) || relation === ".." || relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))) {
    throw new BrowserProfileCleanupError("OUTSIDE_SYSTEM_TEMP", "Temporary root harus berada di dalam canonical system TEMP");
  }
  return { canonicalTemp, normalizedRoot: normalizedCandidate };
}

export function validateBrowserProfileCleanupTarget(target, temporaryRoot, prefix = BROWSER_PROFILE_PREFIX) {
  if (typeof target !== "string" || !isAbsolute(target)) throw new BrowserProfileCleanupError("INVALID_TARGET", "Target profil harus berupa path absolut");
  const { normalizedRoot: validatedTempRoot } = validateBrowserTemporaryRoot(temporaryRoot);
  if (prefix !== BROWSER_PROFILE_PREFIX) throw new BrowserProfileCleanupError("INVALID_PREFIX", "Prefix profil browser tidak diizinkan");
  const normalizedTarget = normalize(resolve(target));
  const normalizedTempRoot = validatedTempRoot;
  const targetName = basename(normalizedTarget);
  const root = parse(normalizedTarget).root;
  const forbidden = [root, normalizedTempRoot, homedir(), process.cwd()];
  if (forbidden.some(path => samePath(normalizedTarget, normalize(resolve(path))))) throw new BrowserProfileCleanupError("FORBIDDEN_TARGET", "Target cleanup menunjuk directory yang dilindungi");
  if (samePath(normalizedTarget, dirname(normalizedTempRoot))) throw new BrowserProfileCleanupError("FORBIDDEN_TARGET", "Target cleanup tidak boleh menjadi parent temporary root");
  if (!samePath(dirname(normalizedTarget), normalizedTempRoot)) throw new BrowserProfileCleanupError("OUTSIDE_TEMP_ROOT", "Target harus tepat satu tingkat di bawah temporary root");
  if (!targetName.startsWith(prefix) || targetName.length === prefix.length) throw new BrowserProfileCleanupError("INVALID_PROFILE_NAME", "Nama profil tidak memiliki prefix dan suffix unik yang valid");
  if (/^(Default|Profile \d+|User Data)$/i.test(targetName)) throw new BrowserProfileCleanupError("CHROME_PROFILE", "Profil Chrome pengguna tidak boleh dihapus");
  return { normalizedTarget, normalizedTempRoot };
}

export function createBrowserProfile({ temporaryRoot = tmpdir() } = {}) {
  const { normalizedRoot: normalizedTempRoot } = validateBrowserTemporaryRoot(temporaryRoot);
  const profilePath = normalize(resolve(mkdtempSync(join(normalizedTempRoot, BROWSER_PROFILE_PREFIX))));
  const token = randomUUID();
  const handle = Object.freeze({ profilePath, temporaryRoot: normalizedTempRoot, prefix: BROWSER_PROFILE_PREFIX, ownershipToken: token });
  profileOwnership.set(handle, { profilePath, temporaryRoot: normalizedTempRoot, prefix: BROWSER_PROFILE_PREFIX, token, active: true });
  return handle;
}

export async function cleanupBrowserProfile(handle, { deadlineMs = 8000, retryDelayMs = 50, stableAbsenceMs = 500, removeTarget = path => rmSync(path, { recursive: true }), pathExists = existsSync, now = Date.now, wait = delay } = {}) {
  if (!handle || typeof handle !== "object") throw new BrowserProfileCleanupError("INVALID_HANDLE", "Handle profil browser tidak valid");
  const owned = profileOwnership.get(handle);
  if (!owned || handle.ownershipToken !== owned.token) throw new BrowserProfileCleanupError("OWNERSHIP_MISMATCH", "Handle tidak memiliki ownership profile ini");
  if (!owned.active) return;
  if (handle.profilePath !== owned.profilePath || handle.temporaryRoot !== owned.temporaryRoot || handle.prefix !== owned.prefix) throw new BrowserProfileCleanupError("HANDLE_TAMPERED", "Metadata handle tidak cocok dengan registry ownership");
  const { normalizedTarget } = validateBrowserProfileCleanupTarget(owned.profilePath, owned.temporaryRoot, owned.prefix);
  if (!pathExists(normalizedTarget)) { owned.active = false; return; }
  const stat = lstatSync(normalizedTarget);
  if (stat.isSymbolicLink()) throw new BrowserProfileCleanupError("LINK_TARGET", "Target cleanup berupa symbolic link atau junction");
  const started = now(); let lastError;
  while (now() - started <= deadlineMs) {
    if (!pathExists(normalizedTarget)) {
      const absentSince=now();
      while (!pathExists(normalizedTarget) && now()-absentSince < stableAbsenceMs && now()-started <= deadlineMs) await wait(Math.min(retryDelayMs,stableAbsenceMs-(now()-absentSince)));
      if (!pathExists(normalizedTarget) && now()-absentSince >= stableAbsenceMs) { owned.active=false;return; }
      continue;
    }
    try { removeTarget(normalizedTarget); lastError = undefined; }
    catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!["EBUSY","EPERM","ENOTEMPTY"].includes(lastError.code)) throw new BrowserProfileCleanupError("DELETE_FAILED", `Penghapusan profil gagal (${lastError.code??"UNKNOWN"}) pada ${normalizedTarget}: ${lastError.message}`);
      if (now() - started >= deadlineMs) break;
      await wait(retryDelayMs);
    }
    if (pathExists(normalizedTarget) && !lastError) {
      lastError = Object.assign(new Error("Target masih tersedia setelah operasi deletion"), { code: "ENOTEMPTY" });
      if (now() - started >= deadlineMs) break;
      await wait(retryDelayMs);
    }
  }
  throw new BrowserProfileCleanupError("DELETE_FAILED", `Profil temporary belum stabil terhapus (${lastError?.code??"UNKNOWN"}) pada ${normalizedTarget}${lastError ? `: ${lastError.message}` : ""}`);
}

export function parseDevToolsActivePort(text) {
  if (typeof text !== "string") return null;
  const [portLine, webSocketPath] = text.trim().split(/\r?\n/);
  const port = Number(portLine);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !webSocketPath?.startsWith("/devtools/browser/")) return null;
  return { port, browserWebSocketPath: webSocketPath };
}

export async function reserveTcpPort(host = "127.0.0.1") {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, host, resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Gagal memperoleh port TCP sementara");
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export async function waitForDevToolsActivePort({ profileDir, isProcessAlive, readText = path => readFile(path, "utf8"), timeoutMs = 10000, pollMs = 25 }) {
  const path = join(profileDir, "DevToolsActivePort"), started = Date.now(); let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (!isProcessAlive()) throw new Error(`Chrome berhenti sebelum DevTools siap${lastError ? `: ${lastError.message}` : ""}`);
    try { const parsed = parseDevToolsActivePort(await readText(path)); if (parsed) return parsed; }
    catch (error) { lastError = error instanceof Error ? error : new Error(String(error)); }
    await delay(pollMs);
  }
  throw new Error(`DevToolsActivePort tidak siap dalam ${timeoutMs} ms${lastError ? `: ${lastError.message}` : ""}`);
}

export async function waitForHttpReady({ url, isProcessAlive, fetchImpl = fetch, timeoutMs = 60000, pollMs = 150, fetchTimeoutMs = 2000, processDetails = () => ({}) }) {
  const started = Date.now(); let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (!isProcessAlive()) { const details=processDetails();throw new Error(`Process berhenti sebelum HTTP siap: ${url}; exit=${details.exitCode??"unknown"}; stdout=${String(details.stdout??"").slice(-500)}; stderr=${String(details.stderr??"").slice(-500)}${lastError ? `; last=${lastError.message}` : ""}`); }
    try { const response = await fetchImpl(url, { signal: AbortSignal.timeout(fetchTimeoutMs) }); if (response.ok) return; lastError = new Error(`HTTP ${response.status}`); }
    catch (error) { lastError = error instanceof Error ? error : new Error(String(error)); }
    await delay(pollMs);
  }
  const details=processDetails(),elapsed=Date.now()-started;
  throw new Error(`HTTP tidak siap: ${url}; elapsed=${elapsed}ms; exit=${details.exitCode??"running"}; stdout=${String(details.stdout??"").slice(-500)}; stderr=${String(details.stderr??"").slice(-500)}; last=${lastError?.message??"tidak ada respons"}`);
}

export async function stopChild(child, timeoutMs = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill();
  const completed = await Promise.race([exited.then(() => true), delay(timeoutMs).then(() => false)]);
  if (!completed) { child.kill("SIGKILL"); await Promise.race([exited, delay(1000)]); }
}

export async function stopOwnedProcessTree(child, { gracefulTimeoutMs = 1500 } = {}) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) throw new Error("Process handle milik run tidak memiliki PID valid");
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill();
    const graceful = await Promise.race([exited.then(()=>true),delay(gracefulTimeoutMs).then(()=>false)]);
    if (!graceful) {
      if (process.platform === "win32") {
        const result=spawnSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,encoding:"utf8"});
        if (result.status && child.exitCode === null) throw new Error(`Gagal menghentikan process tree PID ${child.pid}: ${result.stderr||result.stdout}`);
      } else child.kill("SIGKILL");
      await Promise.race([exited,delay(3000)]);
    }
  }
}

export async function executeBrowserLifecycle({ resolveChromeExecutable, spawnServer, spawnChrome, runBrowser, createProfile = createBrowserProfile, reservePort = reserveTcpPort, stopProcess = stopOwnedProcessTree, cleanupProfile = cleanupBrowserProfile }) {
  let profileHandle = null, serverProcess = null, chromeProcess = null, closeBrowser = null, primaryError = null;
  const cleanupErrors = [], processErrors = new WeakMap();
  const trackProcess = process => {
    if (!process || typeof process.once !== "function") throw new Error("Process factory tidak mengembalikan ChildProcess yang valid");
    process.once("error", error => processErrors.set(process, error instanceof Error ? error : new Error(String(error))));
    return process;
  };
  try {
    const chromeExecutable = await resolveChromeExecutable();
    if (!chromeExecutable) throw new Error("Chrome/Chromium tidak tersedia untuk browser regression test.");
    profileHandle = await createProfile();
    const port = await reservePort();
    serverProcess = trackProcess(spawnServer({ port }));
    chromeProcess = trackProcess(spawnChrome({ chromeExecutable, profilePath: profileHandle.profilePath }));
    await runBrowser({
      port, profileHandle, serverProcess, chromeProcess,
      getProcessError: process => processErrors.get(process) ?? null,
      registerBrowserClose: close => { closeBrowser = close; },
    });
  } catch (error) { primaryError = error instanceof Error ? error : new Error(String(error)); }
  finally {
    if (closeBrowser) try { await closeBrowser(); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error(String(error))); }
    if (chromeProcess) try { await stopProcess(chromeProcess); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error(String(error))); }
    if (serverProcess) try { await stopProcess(serverProcess); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error(String(error))); }
    if (profileHandle) try { await cleanupProfile(profileHandle); } catch (error) { cleanupErrors.push(error instanceof Error ? error : new Error(String(error))); }
  }
  if (primaryError && cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors], "Browser setup/assertion dan cleanup sama-sama gagal");
  if (primaryError) throw primaryError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Satu atau lebih cleanup browser gagal");
}
