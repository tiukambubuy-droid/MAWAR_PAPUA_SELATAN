import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, readdirSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, parse } from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { BROWSER_PROFILE_PREFIX, cleanupBrowserProfile, createBrowserProfile, executeBrowserLifecycle, parseDevToolsActivePort, validateBrowserProfileCleanupTarget, validateBrowserTemporaryRoot, waitForDevToolsActivePort, waitForHttpReady } from "./browser/browser-harness.mjs";

test("DevToolsActivePort parser rejects empty, invalid port, and missing websocket path", () => {
  for (const value of [undefined, "", "abc\n/devtools/browser/x", "70000\n/devtools/browser/x", "9222", "9222\n/devtools/page/x"]) assert.equal(parseDevToolsActivePort(value), null);
  assert.deepEqual(parseDevToolsActivePort("43210\n/devtools/browser/abc\n"), { port: 43210, browserWebSocketPath: "/devtools/browser/abc" });
});

test("DevTools readiness handles unavailable file, early process exit, and eventual success", async () => {
  let reads=0; const result=await waitForDevToolsActivePort({profileDir:"fixture",isProcessAlive:()=>true,readText:async()=>++reads===1?Promise.reject(new Error("ENOENT")):reads===2?"":"45678\n/devtools/browser/ready",timeoutMs:100,pollMs:1});
  assert.deepEqual(result,{port:45678,browserWebSocketPath:"/devtools/browser/ready"});
  await assert.rejects(waitForDevToolsActivePort({profileDir:"fixture",isProcessAlive:()=>false,readText:async()=>"",timeoutMs:20,pollMs:1}),/Chrome berhenti/);
});

test("HTTP readiness fails on process exit and succeeds only on an actual ok response", async () => {
  await assert.rejects(waitForHttpReady({url:"http://fixture",isProcessAlive:()=>false,fetchImpl:async()=>({ok:true}),timeoutMs:20,pollMs:1}),/Process berhenti/);
  let calls=0;await waitForHttpReady({url:"http://fixture",isProcessAlive:()=>true,fetchImpl:async()=>({ok:++calls>1,status:calls>1?200:503}),timeoutMs:100,pollMs:1});assert.equal(calls,2);
});

test("HTTP readiness accepts a slow server before deadline and checks the exact URL", async () => {
  const seen=[];let calls=0;
  await waitForHttpReady({url:"http://127.0.0.1:43210",isProcessAlive:()=>true,fetchImpl:async(url)=>{seen.push(url);return{ok:++calls===3,status:calls===3?200:503}},timeoutMs:100,pollMs:1,fetchTimeoutMs:10});
  assert.equal(calls,3);assert.deepEqual(new Set(seen),new Set(["http://127.0.0.1:43210"]));
});

test("HTTP readiness timeout and early exit include structured diagnostics", async () => {
  await assert.rejects(waitForHttpReady({url:"http://127.0.0.1:40123",isProcessAlive:()=>true,fetchImpl:async()=>{throw new Error("fetch fixture failed")},timeoutMs:5,pollMs:1,fetchTimeoutMs:1,processDetails:()=>({exitCode:null,stdout:"server output",stderr:"server error"})}),error=>/127\.0\.0\.1:40123/.test(error.message)&&/elapsed=/.test(error.message)&&/server output/.test(error.message)&&/fetch fixture failed/.test(error.message));
  await assert.rejects(waitForHttpReady({url:"http://127.0.0.1:40124",isProcessAlive:()=>false,fetchImpl:async()=>({ok:true}),timeoutMs:100,pollMs:1,processDetails:()=>({exitCode:7,stderr:"early exit"})}),error=>/exit=7/.test(error.message)&&/early exit/.test(error.message));
});

test("browser profile creation returns an owned absolute directory directly below TEMP", async () => {
  const handle=createBrowserProfile();
  try {
    assert.ok(isAbsolute(handle.profilePath));assert.equal(dirname(handle.profilePath).toLowerCase(),handle.temporaryRoot.toLowerCase());
    assert.ok(handle.profilePath.split(/[\\/]/).at(-1).startsWith(BROWSER_PROFILE_PREFIX));assert.ok(existsSync(handle.profilePath));assert.ok(handle.ownershipToken);
  } finally { await cleanupBrowserProfile(handle); }
});

test("valid cleanup removes only its owned profile and is idempotent", async () => {
  const handle=createBrowserProfile(),sibling=join(tmpdir(),`mawar-safe-sibling-${randomUUID()}`);mkdirSync(sibling);
  try {
    await cleanupBrowserProfile(handle);assert.equal(existsSync(handle.profilePath),false);assert.equal(existsSync(tmpdir()),true);assert.equal(existsSync(sibling),true);
    await cleanupBrowserProfile(handle);assert.equal(existsSync(sibling),true);
  } finally { if(existsSync(sibling))rmdirSync(sibling); }
});

test("cleanup target validator rejects relative, roots, protected, outside, nested, and invalid names", () => {
  const temp=tmpdir(),root=parse(temp).root;
  const invalid=[
    ["relative-profile",temp,"INVALID_TARGET"],
    [temp,temp,"FORBIDDEN_TARGET"],
    [root,root,"OUTSIDE_SYSTEM_TEMP"],
    [homedir(),dirname(homedir()),"OUTSIDE_SYSTEM_TEMP"],
    [process.cwd(),dirname(process.cwd()),"OUTSIDE_SYSTEM_TEMP"],
    [join(dirname(temp),`${BROWSER_PROFILE_PREFIX}outside`),temp,"OUTSIDE_TEMP_ROOT"],
    [join(temp,"nested",`${BROWSER_PROFILE_PREFIX}deep`),temp,"OUTSIDE_TEMP_ROOT"],
    [join(temp,"not-mawar-profile"),temp,"INVALID_PROFILE_NAME"],
    [join(temp,BROWSER_PROFILE_PREFIX),temp,"INVALID_PROFILE_NAME"],
  ];
  for(const [target,tempRoot,code] of invalid)assert.throws(()=>validateBrowserProfileCleanupTarget(target,tempRoot),error=>error?.code===code,`${target} harus ditolak dengan ${code}`);
});

test("validation failure never deletes the rejected directory or its sibling", () => {
  const rejected=join(tmpdir(),`not-owned-${randomUUID()}`),sibling=join(tmpdir(),`mawar-safe-sibling-${randomUUID()}`);mkdirSync(rejected);mkdirSync(sibling);
  try {
    assert.throws(()=>validateBrowserProfileCleanupTarget(rejected,tmpdir()),error=>error?.code==="INVALID_PROFILE_NAME");
    assert.equal(existsSync(rejected),true);assert.equal(existsSync(sibling),true);
  } finally { rmdirSync(rejected);rmdirSync(sibling); }
});

test("forged handles and tokens cannot authorize recursive cleanup", async () => {
  const handle=createBrowserProfile(),forged={...handle},forgedToken={...handle,ownershipToken:randomUUID()};
  try {
    await assert.rejects(cleanupBrowserProfile(forged),error=>error?.code==="OWNERSHIP_MISMATCH");
    await assert.rejects(cleanupBrowserProfile(forgedToken),error=>error?.code==="OWNERSHIP_MISMATCH");
    assert.equal(existsSync(handle.profilePath),true);
  } finally { await cleanupBrowserProfile(handle); }
});

test("two browser runs have isolated ownership and cleanup", async () => {
  const first=createBrowserProfile(),second=createBrowserProfile();
  try {
    assert.notEqual(first.profilePath,second.profilePath);assert.notEqual(first.ownershipToken,second.ownershipToken);
    await cleanupBrowserProfile(first);assert.equal(existsSync(first.profilePath),false);assert.equal(existsSync(second.profilePath),true);
    await cleanupBrowserProfile(second);assert.equal(existsSync(second.profilePath),false);
  } finally { await cleanupBrowserProfile(first);await cleanupBrowserProfile(second); }
});

test("an externally removed owned profile completes cleanup without touching a sibling", async () => {
  const handle=createBrowserProfile(),sibling=join(tmpdir(),`mawar-safe-sibling-${randomUUID()}`);mkdirSync(sibling);
  try {
    rmdirSync(handle.profilePath);await cleanupBrowserProfile(handle);assert.equal(existsSync(sibling),true);
  } finally { if(existsSync(sibling))rmdirSync(sibling); }
});

test("symbolic link or junction replacement is rejected without following its target", async t => {
  const handle=createBrowserProfile(),destination=createBrowserProfile();rmdirSync(handle.profilePath);
  let linked=false;
  try {
    try { symlinkSync(destination.profilePath,handle.profilePath,process.platform==="win32"?"junction":"dir");linked=true; }
    catch(error) { t.diagnostic(`Symlink/junction capability unavailable: ${error instanceof Error?error.message:String(error)}`); }
    if(linked){await assert.rejects(cleanupBrowserProfile(handle),error=>error?.code==="LINK_TARGET");assert.equal(existsSync(destination.profilePath),true);unlinkSync(handle.profilePath);}
    await cleanupBrowserProfile(handle);await cleanupBrowserProfile(destination);
  } finally {
    if(linked&&existsSync(handle.profilePath))unlinkSync(handle.profilePath);
    await cleanupBrowserProfile(handle);await cleanupBrowserProfile(destination);
  }
});

test("canonical TEMP boundary accepts TEMP descendants and rejects home, CWD, repository, Downloads, and drive root without creating profiles", async t => {
  assert.equal(validateBrowserTemporaryRoot().normalizedRoot.toLowerCase(),validateBrowserTemporaryRoot(tmpdir()).normalizedRoot.toLowerCase());
  const isolated=join(tmpdir(),`mawar-isolated-root-${randomUUID()}`);mkdirSync(isolated);
  try { assert.equal(validateBrowserTemporaryRoot(isolated).normalizedRoot.toLowerCase(),isolated.toLowerCase()); }
  finally { rmdirSync(isolated); }
  const before=readdirSync(tmpdir()).filter(name=>name.startsWith(BROWSER_PROFILE_PREFIX)).sort();
  for(const invalid of [homedir(),process.cwd(),dirname(process.cwd()),join(homedir(),"Downloads"),parse(process.cwd()).root]) {
    assert.throws(()=>createBrowserProfile({temporaryRoot:invalid}),error=>["OUTSIDE_SYSTEM_TEMP","INVALID_TEMP_ROOT"].includes(error?.code),invalid);
  }
  assert.deepEqual(readdirSync(tmpdir()).filter(name=>name.startsWith(BROWSER_PROFILE_PREFIX)).sort(),before);
  const link=join(tmpdir(),`mawar-temp-root-link-${randomUUID()}`);let linked=false;
  try {
    try { symlinkSync(homedir(),link,process.platform==="win32"?"junction":"dir");linked=true; }
    catch(error){t.diagnostic(`Symlink/junction capability unavailable: ${error instanceof Error?error.message:String(error)}`);}
    if(linked)assert.throws(()=>createBrowserProfile({temporaryRoot:link}),error=>["OUTSIDE_SYSTEM_TEMP","INVALID_TEMP_ROOT"].includes(error?.code));
  } finally { if(linked&&existsSync(link))unlinkSync(link); }
});

class FakeChild extends EventEmitter {
  constructor(name,events){super();this.name=name;this.events=events;this.exitCode=null;this.signalCode=null;}
  kill(){this.events.push(`stop:${this.name}`);this.exitCode=0;this.emit("exit",0);return true;}
}

async function runLifecycleScenario(overrides={}) {
  const events=[],state={profiles:0,processes:0};
  const makeProcess=name=>{state.processes++;const child=new FakeChild(name,events);child.once("exit",()=>state.processes--);return child};
  const dependencies={
    resolveChromeExecutable:async()=>"chrome-fixture",
    createProfile:async()=>{state.profiles++;events.push("profile:create");return{profilePath:"profile-fixture"}},
    reservePort:async()=>43210,
    spawnServer:()=>makeProcess("server"),
    spawnChrome:()=>makeProcess("chrome"),
    runBrowser:async({registerBrowserClose})=>{registerBrowserClose(async()=>events.push("browser:close"));},
    stopProcess:async child=>child.kill(),
    cleanupProfile:async()=>{events.push("profile:cleanup");state.profiles--;},
    ...overrides,
  };
  let error=null;try{await executeBrowserLifecycle(dependencies)}catch(caught){error=caught}
  return{events,state,error};
}

test("setup boundary cleans resources for missing Chrome, post-profile failure, and server spawn failure", async () => {
  let result=await runLifecycleScenario({resolveChromeExecutable:async()=>null});assert.match(result.error.message,/tidak tersedia/);assert.deepEqual(result.state,{profiles:0,processes:0});
  result=await runLifecycleScenario({reservePort:async()=>{throw new Error("port failure")}});assert.match(result.error.message,/port failure/);assert.deepEqual(result.state,{profiles:0,processes:0});
  result=await runLifecycleScenario({spawnServer:()=>{throw new Error("server spawn failure")}});assert.match(result.error.message,/server spawn failure/);assert.deepEqual(result.state,{profiles:0,processes:0});
});

test("setup boundary stops server when Chrome spawn fails and handles asynchronous Chrome error", async () => {
  let result=await runLifecycleScenario({spawnChrome:()=>{throw new Error("chrome spawn failure")}});assert.match(result.error.message,/chrome spawn failure/);assert.deepEqual(result.events.slice(-2),["stop:server","profile:cleanup"]);assert.deepEqual(result.state,{profiles:0,processes:0});
  const events=[],child=new FakeChild("chrome",events);
  result=await runLifecycleScenario({spawnChrome:()=>{queueMicrotask(()=>child.emit("error",new Error("async chrome error")));return child},runBrowser:async({getProcessError,chromeProcess})=>{await new Promise(resolve=>setImmediate(resolve));throw getProcessError(chromeProcess)??new Error("missing async error")}});
  assert.match(result.error.message,/async chrome error/);assert.deepEqual(result.state,{profiles:0,processes:0});
});

test("DevTools and assertion failures clean browser, Chrome, server, and profile in order", async () => {
  for(const message of ["DevTools endpoint failure","synthetic assertion failure"]){
    const closeEvents=[];
    const result=await runLifecycleScenario({runBrowser:async({registerBrowserClose})=>{registerBrowserClose(async()=>closeEvents.push("browser:close"));throw new Error(message)}});
    assert.match(result.error.message,new RegExp(message));assert.deepEqual(closeEvents,["browser:close"]);assert.deepEqual(result.events.slice(-3),["stop:chrome","stop:server","profile:cleanup"]);assert.deepEqual(result.state,{profiles:0,processes:0});
  }
});

test("primary assertion and cleanup failure are preserved together", async () => {
  const result=await runLifecycleScenario({runBrowser:async()=>{throw new Error("assertion root")},cleanupProfile:async()=>{throw new Error("cleanup root")}});
  assert.ok(result.error instanceof AggregateError);assert.match(result.error.errors[0].message,/assertion root/);assert.match(result.error.errors[1].message,/cleanup root/);
});

async function exerciseDeleteSequence(codes) {
  const handle=createBrowserProfile();let available=true,calls=0,clock=0;
  try {
    await cleanupBrowserProfile(handle,{deadlineMs:20,retryDelayMs:2,stableAbsenceMs:4,now:()=>clock,wait:async ms=>{clock+=ms},pathExists:()=>available,removeTarget:()=>{const code=codes[calls++];if(code){throw Object.assign(new Error(code),{code})}available=false}});
    return calls;
  } finally { if(existsSync(handle.profilePath))rmdirSync(handle.profilePath); }
}

test("profile deletion retries only transient Windows lock errors", async () => {
  assert.equal(await exerciseDeleteSequence([null]),1);
  assert.equal(await exerciseDeleteSequence(["EBUSY",null]),2);
  assert.equal(await exerciseDeleteSequence(["EBUSY","EBUSY",null]),3);
  assert.equal(await exerciseDeleteSequence(["EPERM",null]),2);
  assert.equal(await exerciseDeleteSequence(["ENOTEMPTY",null]),2);
});

test("non-transient deletion error is not retried and continuous EBUSY reaches DELETE_FAILED", async () => {
  let handle=createBrowserProfile(),calls=0;
  try { await assert.rejects(cleanupBrowserProfile(handle,{removeTarget:()=>{calls++;throw Object.assign(new Error("denied"),{code:"EACCES"})}}),error=>error?.code==="DELETE_FAILED"&&/EACCES/.test(error.message));assert.equal(calls,1); }
  finally { await cleanupBrowserProfile(handle); }
  handle=createBrowserProfile();calls=0;let clock=0;
  try { await assert.rejects(cleanupBrowserProfile(handle,{deadlineMs:5,retryDelayMs:1,now:()=>clock,wait:async ms=>{clock+=ms},removeTarget:()=>{calls++;throw Object.assign(new Error("locked"),{code:"EBUSY"})}}),error=>error?.code==="DELETE_FAILED"&&/EBUSY/.test(error.message)&&error.message.includes(handle.profilePath));assert.ok(calls>1); }
  finally { await cleanupBrowserProfile(handle); }
});
