export type BigMapLoadContext = {
  requestKey: string;
  regionId: string;
  regionLevel: "province" | "district";
};

export type BigMapSourceMode = "big" | "fallback";

export type BigMapCallbackPhase = "loading" | "success" | "failure";

export type BigMapCallbackError = {
  phase: BigMapCallbackPhase;
  error: unknown;
  context: BigMapLoadContext;
};

export type BigMapLoadDependencies<TFeature> = {
  loadRemote: (context: BigMapLoadContext, signal: AbortSignal) => Promise<TFeature[]>;
  loadFallback?: (context: BigMapLoadContext, signal: AbortSignal) => Promise<TFeature[]>;
  shouldLoadFallback?: (context: BigMapLoadContext) => boolean;
};

export const BIG_REMOTE_TIMEOUT_MS = 10_000;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export type BigMapRequestControllerOptions = {
  remoteTimeoutMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

export type BigMapLoadCallbacks<TFeature> = {
  onLoading: (context: BigMapLoadContext) => void;
  onSuccess: (features: TFeature[], sourceMode: BigMapSourceMode, context: BigMapLoadContext) => void;
  onFailure: (error: unknown, context: BigMapLoadContext) => void;
  onCallbackError?: (incident: BigMapCallbackError) => void;
};

export type BigMapViewState<TFeature> = {
  features: TFeature[];
  sourceMode: BigMapSourceMode;
  status: "loading" | "ready" | "error";
  context: BigMapLoadContext | null;
};

export type BigMapViewEvent<TFeature> =
  | { type: "loading"; context: BigMapLoadContext }
  | { type: "success"; features: TFeature[]; sourceMode: BigMapSourceMode; context: BigMapLoadContext }
  | { type: "failure"; context: BigMapLoadContext };

export function reduceBigMapViewState<TFeature>(state: BigMapViewState<TFeature>, event: BigMapViewEvent<TFeature>): BigMapViewState<TFeature> {
  if (event.type === "loading") return { ...state, status: "loading", context: event.context };
  if (event.type === "success") return { features: event.features, sourceMode: event.sourceMode, status: "ready", context: event.context };
  return { ...state, status: "error", context: event.context };
}

export function createBigMapViewCallbacks<TFeature>(dispatch: (event: BigMapViewEvent<TFeature>) => void): BigMapLoadCallbacks<TFeature> {
  return {
    onLoading: context => dispatch({ type: "loading", context }),
    onSuccess: (features, sourceMode, context) => dispatch({ type: "success", features, sourceMode, context }),
    onFailure: (_error, context) => dispatch({ type: "failure", context }),
  };
}

export function createBigMapRequestController<TFeature>(
  dependencies: BigMapLoadDependencies<TFeature>,
  callbacks: BigMapLoadCallbacks<TFeature>,
  options: BigMapRequestControllerOptions = {},
) {
  const configuredTimeoutMs = options.remoteTimeoutMs ?? BIG_REMOTE_TIMEOUT_MS;
  const remoteTimeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : BIG_REMOTE_TIMEOUT_MS;
  const setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? (handle => globalThis.clearTimeout(handle));
  let generation = 0;
  let activeController: AbortController | null = null;
  let activeTimer: TimerHandle | null = null;
  let latestContext: BigMapLoadContext | null = null;
  let disposed = false;

  const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError";
  const isCurrent = (token: number) => !disposed && token === generation;

  const clearActiveTimer = () => {
    if (activeTimer === null) return;
    clearTimer(activeTimer);
    activeTimer = null;
  };

  const cancelActiveRequest = () => {
    clearActiveTimer();
    activeController?.abort();
    activeController = null;
  };

  const reportCallbackError = (incident: BigMapCallbackError) => {
    try {
      callbacks.onCallbackError?.(incident);
    } catch {
      // The reporter is the terminal exception boundary and must never recurse.
    }
  };

  const safelyInvoke = (phase: BigMapCallbackPhase, context: BigMapLoadContext, callback: () => void) => {
    try {
      callback();
    } catch (error) {
      reportCallbackError({ phase, error, context });
    }
  };

  const run = async (context: BigMapLoadContext) => {
    cancelActiveRequest();
    const token = ++generation;
    latestContext = context;
    if (disposed) return;
    safelyInvoke("loading", context, () => callbacks.onLoading(context));

    const remoteController = new AbortController();
    activeController = remoteController;
    let remoteFeatures: TFeature[] | null = null;
    let remoteError: unknown;
    let didTimeout = false;
    let remoteTimer: TimerHandle | null = null;
    let removeAbortListener = () => {};
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          const error = new Error("BIG request cancelled");
          error.name = "AbortError";
          reject(error);
        };
        remoteController.signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => remoteController.signal.removeEventListener("abort", onAbort);
      });
      const timedOut = new Promise<never>((_resolve, reject) => {
        remoteTimer = setTimer(() => {
          if (!isCurrent(token) || remoteController.signal.aborted) return;
          didTimeout = true;
          reject(new Error(`BIG remote request timed out after ${remoteTimeoutMs} ms`));
          remoteController.abort();
        }, remoteTimeoutMs);
        activeTimer = remoteTimer;
      });
      remoteFeatures = await Promise.race([
        dependencies.loadRemote(context, remoteController.signal),
        aborted,
        timedOut,
      ]);
      if (!remoteFeatures.length) throw new Error("No boundary features");
    } catch (error) {
      remoteError = error;
    } finally {
      removeAbortListener();
      if (remoteTimer !== null) clearTimer(remoteTimer);
      if (activeTimer === remoteTimer) activeTimer = null;
    }

    if (remoteFeatures) {
      if (isCurrent(token)) {
        activeController = null;
        safelyInvoke("success", context, () => callbacks.onSuccess(remoteFeatures, "big", context));
      }
      return;
    }

    if (!isCurrent(token) || (isAbort(remoteError) && !didTimeout)) return;

    const fallbackController = new AbortController();
    activeController = fallbackController;
    let fallbackFeatures: TFeature[] | null = null;
    let fallbackError: unknown;
    let removeFallbackAbortListener = () => {};
    try {
      if (!dependencies.loadFallback || dependencies.shouldLoadFallback?.(context) === false) throw remoteError;
      const fallbackAborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => {
          const error = new Error("BIG fallback request cancelled");
          error.name = "AbortError";
          reject(error);
        };
        fallbackController.signal.addEventListener("abort", onAbort, { once: true });
        removeFallbackAbortListener = () => fallbackController.signal.removeEventListener("abort", onAbort);
      });
      fallbackFeatures = await Promise.race([
        dependencies.loadFallback(context, fallbackController.signal),
        fallbackAborted,
      ]);
      if (!fallbackFeatures.length) throw new Error("No fallback boundary features");
    } catch (error) {
      fallbackError = error;
    } finally {
      removeFallbackAbortListener();
    }

    if (fallbackFeatures) {
      if (isCurrent(token) && !fallbackController.signal.aborted) {
        activeController = null;
        safelyInvoke("success", context, () => callbacks.onSuccess(fallbackFeatures, "fallback", context));
      }
      return;
    }

    if (isAbort(fallbackError) || !isCurrent(token) || fallbackController.signal.aborted) return;
    activeController = null;
    safelyInvoke("failure", context, () => callbacks.onFailure(fallbackError, context));
  };

  return {
    load(context: BigMapLoadContext) {
      if (disposed) return Promise.resolve();
      return run(context);
    },
    retry() {
      if (disposed || !latestContext) return Promise.resolve();
      return run(latestContext);
    },
    cancel() {
      generation += 1;
      cancelActiveRequest();
    },
    dispose() {
      disposed = true;
      generation += 1;
      cancelActiveRequest();
    },
  };
}

export type BigMapRequestController<TFeature> = ReturnType<typeof createBigMapRequestController<TFeature>>;
