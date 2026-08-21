import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadControllerModule() {
  const source = await readFile("lib/big-map-request-controller.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const controllerModule = await loadControllerModule();
const context = (requestKey, regionId = "93.01", regionLevel = "district") => ({ requestKey, regionId, regionLevel });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

function createFakeClock() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimer(callback) { const id = nextId++; tasks.set(id, callback); return id; },
    clearTimer(id) { tasks.delete(id); },
    fireNext() {
      const entry = tasks.entries().next().value;
      assert.ok(entry, "expected an active timeout");
      const [id, callback] = entry;
      tasks.delete(id);
      callback();
    },
    get size() { return tasks.size; },
  };
}

function createHarness(remoteLoads, fallbackLoads = [], controllerOptions = {}, includeFallback = true) {
  const calls = { remote: [], fallback: [], loading: [], success: [], failure: [] };
  let state = { features: [], sourceMode: "big", status: "ready", context: null };
  const viewCallbacks = controllerModule.createBigMapViewCallbacks(event => {
    if (event.type === "loading") calls.loading.push(event.context);
    if (event.type === "success") calls.success.push({ features: event.features, sourceMode: event.sourceMode, context: event.context });
    if (event.type === "failure") calls.failure.push({ context: event.context });
    state = controllerModule.reduceBigMapViewState(state, event);
  });
  const dependencies = {
    loadRemote: (loadContext, signal) => {
      calls.remote.push({ context: loadContext, signal });
      return remoteLoads[calls.remote.length - 1].promise;
    },
    ...(includeFallback ? { loadFallback: (loadContext, signal) => {
      calls.fallback.push({ context: loadContext, signal });
      return fallbackLoads[calls.fallback.length - 1].promise;
    } } : {}),
  };
  const controller = controllerModule.createBigMapRequestController(dependencies, viewCallbacks, controllerOptions);
  return { controller, calls, getState: () => state };
}

test("production BIG timeout is centralized at ten seconds", () => {
  assert.equal(controllerModule.BIG_REMOTE_TIMEOUT_MS, 10_000);
});

test("remote success before timeout applies BIG once and clears its timer", async () => {
  const remote = deferred(), fallback = deferred(), clock = createFakeClock();
  const harness = createHarness([remote], [fallback], { remoteTimeoutMs: 5, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const pending = harness.controller.load(context("remote-before-timeout"));
  assert.equal(clock.size, 1);
  remote.resolve([{ id: "remote" }]);
  await pending;
  assert.equal(clock.size, 0);
  assert.equal(harness.calls.fallback.length, 0);
  assert.deepEqual(harness.calls.success.map(call => call.sourceMode), ["big"]);
});

test("hanging remote times out, aborts, and invokes fallback exactly once", async () => {
  const remote = deferred(), fallback = deferred(), clock = createFakeClock();
  const harness = createHarness([remote], [fallback], { remoteTimeoutMs: 5, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const pending = harness.controller.load(context("hanging-district"));
  clock.fireNext();
  assert.equal(harness.calls.remote[0].signal.aborted, true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.calls.fallback.length, 1);
  fallback.resolve([{ id: "local" }]);
  await pending;
  assert.equal(harness.calls.success.length, 1);
  assert.equal(harness.calls.success[0].sourceMode, "fallback");
  assert.equal(harness.getState().status, "ready");
});

test("remote completion after timeout cannot replace the final fallback result", async () => {
  const remote = deferred(), fallback = deferred(), clock = createFakeClock();
  const harness = createHarness([remote], [fallback], { remoteTimeoutMs: 5, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const pending = harness.controller.load(context("late-remote"));
  clock.fireNext();
  await Promise.resolve();
  fallback.resolve([{ id: "fallback-final" }]);
  await pending;
  remote.resolve([{ id: "late-remote" }]);
  await Promise.resolve();
  assert.deepEqual(harness.getState().features, [{ id: "fallback-final" }]);
  assert.deepEqual(harness.calls.success.map(call => call.sourceMode), ["fallback"]);
});

test("cancel before timeout clears the timer and never starts stale fallback", async () => {
  const remote = deferred(), fallback = deferred(), clock = createFakeClock();
  const harness = createHarness([remote], [fallback], { remoteTimeoutMs: 5, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const pending = harness.controller.load(context("cancel-before-timeout"));
  harness.controller.cancel();
  await pending;
  assert.equal(clock.size, 0);
  assert.equal(harness.calls.remote[0].signal.aborted, true);
  assert.equal(harness.calls.fallback.length, 0);
  assert.equal(harness.calls.success.length, 0);
  assert.equal(harness.calls.failure.length, 0);
});

test("a new generation clears the old timeout without affecting its own timer or result", async () => {
  const oldRemote = deferred(), newRemote = deferred(), clock = createFakeClock();
  const harness = createHarness([oldRemote, newRemote], [], { remoteTimeoutMs: 5, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const oldPending = harness.controller.load(context("old"));
  const newPending = harness.controller.load(context("new"));
  await oldPending;
  assert.equal(clock.size, 1);
  newRemote.resolve([{ id: "new" }]);
  await newPending;
  assert.equal(clock.size, 0);
  assert.deepEqual(harness.getState().features, [{ id: "new" }]);
  assert.deepEqual(harness.calls.success.map(call => call.context.requestKey), ["new"]);
});

test("dispose before timeout clears resources and prevents every later callback", async () => {
  const remote = deferred(), clock = createFakeClock();
  const harness = createHarness([remote], [], { remoteTimeoutMs: 5, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const pending = harness.controller.load(context("dispose-before-timeout"));
  harness.controller.dispose();
  await pending;
  assert.equal(clock.size, 0);
  assert.equal(harness.calls.remote[0].signal.aborted, true);
  assert.equal(harness.calls.success.length, 0);
  assert.equal(harness.calls.failure.length, 0);
});

test("timeout without a fallback ends loading in an explicit failure state", async () => {
  const remote = deferred(), clock = createFakeClock();
  const harness = createHarness([remote], [], { remoteTimeoutMs: 5, setTimer: clock.setTimer, clearTimer: clock.clearTimer }, false);
  const pending = harness.controller.load(context("province-timeout", "93", "province"));
  clock.fireNext();
  await pending;
  assert.equal(harness.calls.fallback.length, 0);
  assert.equal(harness.calls.failure.length, 1);
  assert.equal(harness.getState().status, "error");
});

test("fallback rejection after timeout is handled once and ends loading", async () => {
  const remote = deferred(), fallback = deferred(), clock = createFakeClock();
  const harness = createHarness([remote], [fallback], { remoteTimeoutMs: 5, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
  const pending = harness.controller.load(context("fallback-fails"));
  clock.fireNext();
  await Promise.resolve();
  fallback.reject(new Error("fallback down"));
  await pending;
  assert.equal(harness.calls.fallback.length, 1);
  assert.equal(harness.calls.failure.length, 1);
  assert.equal(harness.getState().status, "error");
});

test("production BIG controller aborts stale requests and only applies the latest geometry state", async () => {
  const first = deferred(), second = deferred(), third = deferred();
  const harness = createHarness([first, second, third]);
  const pendingFirst = harness.controller.load(context("merauke-1"));
  const pendingSecond = harness.controller.load(context("semangga-2", "93.01.05"));
  assert.equal(harness.calls.remote[0].signal.aborted, true);
  const pendingThird = harness.controller.load(context("merauke-3"));
  assert.equal(harness.calls.remote[1].signal.aborted, true);
  third.resolve([{ id: "latest-regency" }]);
  await pendingThird;
  second.resolve([{ id: "stale-semangga" }]);
  first.resolve([{ id: "stale-regency" }]);
  await Promise.all([pendingFirst, pendingSecond]);
  assert.deepEqual(harness.calls.success, [{ features: [{ id: "latest-regency" }], sourceMode: "big", context: context("merauke-3") }]);
  assert.equal(harness.calls.failure.length, 0);
  assert.deepEqual(harness.getState(), { features: [{ id: "latest-regency" }], sourceMode: "big", status: "ready", context: context("merauke-3") });
});

test("production BIG controller uses fallback after remote failure", async () => {
  const remote = deferred(), fallback = deferred();
  const harness = createHarness([remote], [fallback]);
  const pending = harness.controller.load(context("semangga"));
  remote.reject(new Error("network"));
  await Promise.resolve();
  fallback.resolve([{ id: "local-semangga" }]);
  await pending;
  assert.equal(harness.calls.success.length, 1);
  assert.equal(harness.calls.success[0].sourceMode, "fallback");
  assert.equal(harness.calls.failure.length, 0);
  assert.equal(harness.getState().status, "ready");
});

test("production BIG controller reports total failure to rendered map state", async () => {
  const remote = deferred(), fallback = deferred();
  const harness = createHarness([remote], [fallback]);
  const pending = harness.controller.load(context("semangga"));
  remote.reject(new Error("remote down"));
  await Promise.resolve();
  fallback.reject(new Error("fallback down"));
  await pending;
  assert.equal(harness.calls.success.length, 0);
  assert.equal(harness.calls.failure.length, 1);
  assert.equal(harness.getState().status, "error");
  assert.equal(harness.getState().context.requestKey, "semangga");
  assert.deepEqual(Object.keys(harness.getState()).sort(), ["context", "features", "sourceMode", "status"]);
});

test("retry creates a fresh request with the latest context and stale completion cannot overwrite it", async () => {
  const oldRemote = deferred(), oldFallback = deferred(), retryRemote = deferred();
  const harness = createHarness([oldRemote, retryRemote], [oldFallback]);
  const oldPending = harness.controller.load(context("semangga-current", "93.01.05"));
  oldRemote.reject(new Error("remote down"));
  await Promise.resolve();
  oldFallback.reject(new Error("fallback down"));
  await oldPending;
  assert.equal(harness.getState().status, "error");
  const retryPending = harness.controller.retry();
  assert.notEqual(harness.calls.remote[0].signal, harness.calls.remote[1].signal);
  retryRemote.resolve([{ id: "retry-semangga" }]);
  await retryPending;
  assert.equal(harness.getState().status, "ready");
  assert.equal(harness.getState().context.regionId, "93.01.05");
  assert.deepEqual(harness.getState().features, [{ id: "retry-semangga" }]);
});

test("dispose aborts the active request and prevents all component-state callbacks", async () => {
  const remote = deferred();
  const harness = createHarness([remote]);
  const pending = harness.controller.load(context("dispose-me"));
  const callbackCount = harness.calls.loading.length;
  harness.controller.dispose();
  assert.equal(harness.calls.remote[0].signal.aborted, true);
  remote.resolve([{ id: "too-late" }]);
  await pending;
  assert.equal(harness.calls.loading.length, callbackCount);
  assert.equal(harness.calls.success.length, 0);
  assert.equal(harness.calls.failure.length, 0);
});

test("retry uses Semangga as the latest context after replacing Merauke", async () => {
  const merauke = deferred(), semangga = deferred(), semanggaFallback = deferred(), retry = deferred();
  const harness = createHarness([merauke, semangga, retry], [semanggaFallback]);
  const old = harness.controller.load(context("merauke"));
  const failed = harness.controller.load(context("semangga", "93.01.05"));
  semangga.reject(new Error("down"));
  await Promise.resolve();
  semanggaFallback.reject(new Error("fallback down"));
  await failed;
  const retried = harness.controller.retry();
  assert.equal(harness.calls.remote[2].context.regionId, "93.01.05");
  retry.resolve([{ id: "semangga-retry" }]);
  await retried;
  merauke.resolve([{ id: "stale-merauke" }]);
  await old;
  assert.deepEqual(harness.getState().features, [{ id: "semangga-retry" }]);
});

test("production controller, callback adapter and reducer drive the same view-state contract used by the map page", async () => {
  const remote = deferred();
  const harness = createHarness([remote]);
  const loadContext = context("view-state-integration", "93.01.05");
  const pending = harness.controller.load(loadContext);
  assert.deepEqual(harness.getState(), { features: [], sourceMode: "big", status: "loading", context: loadContext });
  remote.resolve([{ id: "rendered-feature" }]);
  await pending;
  assert.deepEqual(harness.getState(), {
    features: [{ id: "rendered-feature" }],
    sourceMode: "big",
    status: "ready",
    context: loadContext,
  });

  // Supplemental wiring audit: the component imports and uses the production integration above.
  const page = await readFile("app/page.tsx", "utf8");
  assert.match(page, /createBigMapRequestController<GeoFeature>/);
  assert.match(page, /createBigMapViewCallbacks<GeoFeature>/);
  assert.match(page, /setMapRequestState\(state => reduceBigMapViewState\(state, event\)\)/);
  assert.match(page, /requestControllerRef\.current\?\.retry\(\)/);
  assert.match(page, /controller\.dispose\(\)/);
});

function createExceptionHarness({ remote, fallback, onLoading, onSuccess, onFailure, onCallbackError }) {
  const calls = { remote: 0, fallback: 0, loading: 0, success: 0, failure: 0, incidents: [] };
  const controller = controllerModule.createBigMapRequestController({
    loadRemote: async (loadContext, signal) => {
      calls.remote += 1;
      return remote(loadContext, signal, calls.remote);
    },
    loadFallback: async (loadContext, signal) => {
      calls.fallback += 1;
      return fallback(loadContext, signal, calls.fallback);
    },
  }, {
    onLoading: loadContext => { calls.loading += 1; onLoading?.(loadContext); },
    onSuccess: (features, mode, loadContext) => { calls.success += 1; onSuccess?.(features, mode, loadContext); },
    onFailure: (error, loadContext) => { calls.failure += 1; onFailure?.(error, loadContext); },
    onCallbackError: incident => { calls.incidents.push(incident); onCallbackError?.(incident); },
  });
  return { controller, calls };
}

test("onLoading exception is reported while the remote lifecycle continues and fulfills", async () => {
  const expectedContext = context("loading-exception");
  const harness = createExceptionHarness({
    remote: async () => [{ id: "remote" }],
    fallback: async () => { throw new Error("fallback must not run"); },
    onLoading: () => { throw new Error("loading boom"); },
  });
  await harness.controller.load(expectedContext);
  assert.equal(harness.calls.remote, 1);
  assert.equal(harness.calls.success, 1);
  assert.equal(harness.calls.failure, 0);
  assert.equal(harness.calls.incidents.length, 1);
  assert.equal(harness.calls.incidents[0].phase, "loading");
  assert.equal(harness.calls.incidents[0].error.message, "loading boom");
  assert.deepEqual(harness.calls.incidents[0].context, expectedContext);
});

test("remote onSuccess exception is reported without false fallback or failure", async () => {
  const harness = createExceptionHarness({
    remote: async () => [{ id: "remote" }],
    fallback: async () => [{ id: "fallback" }],
    onSuccess: () => { throw new Error("success boom"); },
  });
  await harness.controller.load(context("remote-success-exception"));
  assert.equal(harness.calls.success, 1);
  assert.equal(harness.calls.fallback, 0);
  assert.equal(harness.calls.failure, 0);
  assert.deepEqual(harness.calls.incidents.map(item => [item.phase, item.error.message]), [["success", "success boom"]]);
});

test("fallback onSuccess exception is reported without retrying fallback or calling failure", async () => {
  const harness = createExceptionHarness({
    remote: async () => { throw new Error("remote down"); },
    fallback: async () => [{ id: "fallback" }],
    onSuccess: () => { throw new Error("fallback success boom"); },
  });
  await harness.controller.load(context("fallback-success-exception"));
  assert.equal(harness.calls.remote, 1);
  assert.equal(harness.calls.fallback, 1);
  assert.equal(harness.calls.success, 1);
  assert.equal(harness.calls.failure, 0);
  assert.equal(harness.calls.incidents[0].phase, "success");
});

test("onFailure exception is reported once without recursion or rejection", async () => {
  const harness = createExceptionHarness({
    remote: async () => { throw new Error("remote down"); },
    fallback: async () => { throw new Error("fallback down"); },
    onFailure: () => { throw new Error("failure boom"); },
  });
  await harness.controller.load(context("failure-exception"));
  assert.equal(harness.calls.failure, 1);
  assert.equal(harness.calls.incidents.length, 1);
  assert.equal(harness.calls.incidents[0].phase, "failure");
  assert.equal(harness.calls.incidents[0].error.message, "failure boom");
});

test("callback error reporter exception is contained without recursion or false fallback", async () => {
  const harness = createExceptionHarness({
    remote: async () => [{ id: "remote" }],
    fallback: async () => [{ id: "fallback" }],
    onSuccess: () => { throw new Error("success boom"); },
    onCallbackError: () => { throw new Error("reporter boom"); },
  });
  await harness.controller.load(context("reporter-exception"));
  assert.equal(harness.calls.incidents.length, 1);
  assert.equal(harness.calls.fallback, 0);
  assert.equal(harness.calls.failure, 0);
});

test("retry success callback exception fulfills and preserves latest context", async () => {
  const latestContext = context("semangga-retry-exception", "93.01.05");
  const harness = createExceptionHarness({
    remote: async (_context, _signal, attempt) => {
      if (attempt === 1) throw new Error("remote down");
      return [{ id: "retry" }];
    },
    fallback: async () => { throw new Error("fallback down"); },
    onSuccess: () => { throw new Error("retry success boom"); },
  });
  await harness.controller.load(latestContext);
  assert.equal(harness.calls.failure, 1);
  await harness.controller.retry();
  assert.equal(harness.calls.remote, 2);
  assert.equal(harness.calls.fallback, 1);
  assert.equal(harness.calls.failure, 1);
  assert.equal(harness.calls.incidents[0].phase, "success");
  assert.deepEqual(harness.calls.incidents[0].context, latestContext);
});

test("stale completion never invokes throwing callback or callback reporter", async () => {
  const stale = deferred();
  const harness = createExceptionHarness({
    remote: async (loadContext) => loadContext.requestKey === "stale" ? stale.promise : [{ id: "latest" }],
    fallback: async () => { throw new Error("fallback must not run"); },
    onSuccess: (_features, _mode, loadContext) => {
      if (loadContext.requestKey === "stale") throw new Error("stale callback boom");
    },
  });
  const stalePending = harness.controller.load(context("stale"));
  await harness.controller.load(context("latest"));
  stale.resolve([{ id: "stale" }]);
  await stalePending;
  assert.equal(harness.calls.success, 1);
  assert.equal(harness.calls.incidents.length, 0);
  assert.equal(harness.calls.failure, 0);
});
