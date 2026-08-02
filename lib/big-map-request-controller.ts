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
  loadFallback: (context: BigMapLoadContext, signal: AbortSignal) => Promise<TFeature[]>;
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
) {
  let generation = 0;
  let activeController: AbortController | null = null;
  let latestContext: BigMapLoadContext | null = null;
  let disposed = false;

  const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError";
  const isCurrent = (token: number, signal: AbortSignal) => !disposed && !signal.aborted && token === generation;

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
    activeController?.abort();
    const token = ++generation;
    const controller = new AbortController();
    activeController = controller;
    latestContext = context;
    if (disposed) return;
    safelyInvoke("loading", context, () => callbacks.onLoading(context));

    let remoteFeatures: TFeature[] | null = null;
    let remoteError: unknown;
    try {
      remoteFeatures = await dependencies.loadRemote(context, controller.signal);
      if (!remoteFeatures.length) throw new Error("No boundary features");
    } catch (error) {
      remoteError = error;
    }

    if (remoteFeatures) {
      if (isCurrent(token, controller.signal)) {
        safelyInvoke("success", context, () => callbacks.onSuccess(remoteFeatures, "big", context));
      }
      return;
    }

    if (isAbort(remoteError) || !isCurrent(token, controller.signal)) return;

    let fallbackFeatures: TFeature[] | null = null;
    let fallbackError: unknown;
    try {
      fallbackFeatures = await dependencies.loadFallback(context, controller.signal);
      if (!fallbackFeatures.length) throw new Error("No fallback boundary features");
    } catch (error) {
      fallbackError = error;
    }

    if (fallbackFeatures) {
      if (isCurrent(token, controller.signal)) {
        safelyInvoke("success", context, () => callbacks.onSuccess(fallbackFeatures, "fallback", context));
      }
      return;
    }

    if (isAbort(fallbackError) || !isCurrent(token, controller.signal)) return;
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
      activeController?.abort();
      activeController = null;
    },
    dispose() {
      disposed = true;
      generation += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}

export type BigMapRequestController<TFeature> = ReturnType<typeof createBigMapRequestController<TFeature>>;
