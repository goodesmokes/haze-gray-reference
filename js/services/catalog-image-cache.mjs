import { isValidCatalogImageUrl } from "../domain/catalog-images.mjs";

export const CATALOG_IMAGE_CACHE_MESSAGE = "haze-gray-reference:catalog-images";
export const CATALOG_IMAGE_CACHE_RESULT_MESSAGE = "haze-gray-reference:catalog-images-result";
export const CATALOG_IMAGE_CACHE_NAME = "haze-gray-reference-catalog-images-v1";
export const CATALOG_IMAGE_ACK_TIMEOUT_MS = 1800;
export const CATALOG_IMAGE_LOAD_TIMEOUT_MS = 3000;

export const CATALOG_IMAGE_RECOVERY = Object.freeze({
  SERVICE_WORKER_UNAVAILABLE: "service-worker-unavailable",
  SERVICE_WORKER_READY_TIMEOUT: "service-worker-ready-timeout",
  NO_CONTROLLER: "no-controller",
  WORKER_ACKNOWLEDGEMENT_TIMEOUT: "worker-acknowledgement-timeout",
  WORKER_MESSAGE_FAILURE: "worker-message-failure",
  CACHE_UNAVAILABLE: "cache-unavailable",
  CACHE_OPEN_FAILURE: "cache-open-failure",
  CACHE_MISS: "cache-miss",
  INVALID_RESPONSE_MIME: "invalid-response-mime",
  BLOB_CONVERSION_FAILURE: "blob-conversion-failure",
  BLOB_LOAD_DECODE_FAILURE: "blob-load-decode-failure",
  RECOVERED_NORMAL_URL: "recovered-normal-url",
  RECOVERED_BLOB: "recovered-blob",
  RECOVERY_IN_PROGRESS: "recovery-in-progress",
  RECOVERY_EXHAUSTED: "recovery-exhausted",
  INVALID_PATH: "invalid-path"
});

let requestSequence = 0;

function recoveryResult(ok, reason, details = {}) {
  return { ok, reason, ...details };
}

function approvedCatalogImagePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.filter((path) => path && isValidCatalogImageUrl(path)))].sort();
}

export function catalogImagePaths(records) {
  if (!Array.isArray(records)) return [];
  return approvedCatalogImagePaths(records.map((record) => record?.imageUrl));
}

function boundedPromise(promise, timeoutMs, timeoutReason, { setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}, rejectionReason = CATALOG_IMAGE_RECOVERY.SERVICE_WORKER_UNAVAILABLE) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimer?.(timer);
      resolve(value);
    };
    timer = setTimer?.(() => finish(recoveryResult(false, timeoutReason)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => finish(recoveryResult(true, "ready", { value })),
      () => finish(recoveryResult(false, rejectionReason))
    );
  });
}

async function waitForController(serviceWorker, timeoutMs, timers) {
  if (serviceWorker.controller) return recoveryResult(true, "controller-ready", { worker: serviceWorker.controller });
  if (!serviceWorker.addEventListener) return recoveryResult(false, CATALOG_IMAGE_RECOVERY.NO_CONTROLLER);
  let listener;
  const changed = new Promise((resolve) => {
    listener = () => resolve(serviceWorker.controller || null);
    serviceWorker.addEventListener("controllerchange", listener);
    if (serviceWorker.controller) resolve(serviceWorker.controller);
  });
  const result = await boundedPromise(changed, timeoutMs, CATALOG_IMAGE_RECOVERY.NO_CONTROLLER, timers);
  serviceWorker.removeEventListener?.("controllerchange", listener);
  return result.ok && result.value
    ? recoveryResult(true, "controller-ready", { worker: result.value })
    : recoveryResult(false, CATALOG_IMAGE_RECOVERY.NO_CONTROLLER);
}

export async function requestCatalogImageCachePaths(paths, {
  operation = "probe",
  authoritative = false,
  requireController = operation === "probe",
  serviceWorker = globalThis.navigator?.serviceWorker,
  MessageChannelCtor = globalThis.MessageChannel,
  timeoutMs = CATALOG_IMAGE_ACK_TIMEOUT_MS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
} = {}) {
  const approved = approvedCatalogImagePaths(paths);
  if (!approved.length && operation !== "synchronize") {
    return recoveryResult(false, CATALOG_IMAGE_RECOVERY.INVALID_PATH, { present: [], missing: [] });
  }
  if (!serviceWorker?.ready || !MessageChannelCtor) {
    return recoveryResult(false, CATALOG_IMAGE_RECOVERY.SERVICE_WORKER_UNAVAILABLE, { present: [], missing: approved });
  }

  const timers = { setTimer, clearTimer };
  const ready = await boundedPromise(serviceWorker.ready, timeoutMs, CATALOG_IMAGE_RECOVERY.SERVICE_WORKER_READY_TIMEOUT, timers);
  if (!ready.ok) return { ...ready, present: [], missing: approved };

  let worker = serviceWorker.controller;
  if (requireController && !worker) {
    const controller = await waitForController(serviceWorker, timeoutMs, timers);
    if (!controller.ok) return { ...controller, present: [], missing: approved };
    worker = controller.worker;
  } else if (!worker) {
    worker = ready.value?.active;
  }
  if (!worker) return recoveryResult(false, CATALOG_IMAGE_RECOVERY.NO_CONTROLLER, { present: [], missing: approved });

  const requestId = `catalog-image-${Date.now()}-${++requestSequence}`;
  let channel;
  try {
    channel = new MessageChannelCtor();
  } catch {
    return recoveryResult(false, CATALOG_IMAGE_RECOVERY.WORKER_MESSAGE_FAILURE, {
      requestId, present: [], missing: approved
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimer?.(timer);
      channel.port1.onmessage = null;
      channel.port1.close?.();
      resolve(result);
    };
    timer = setTimer?.(() => finish(recoveryResult(false, CATALOG_IMAGE_RECOVERY.WORKER_ACKNOWLEDGEMENT_TIMEOUT, {
      requestId, present: [], missing: approved
    })), timeoutMs);
    channel.port1.onmessage = (event) => {
      const data = event.data;
      if (data?.type !== CATALOG_IMAGE_CACHE_RESULT_MESSAGE || data.requestId !== requestId) return;
      const present = approved.filter((path) => data.present?.includes(path));
      const missing = approved.filter((path) => !present.includes(path));
      finish(recoveryResult(data.ok === true, data.reason || (missing.length ? CATALOG_IMAGE_RECOVERY.CACHE_MISS : "worker-ready"), {
        requestId, present, missing
      }));
    };
    try {
      worker.postMessage({
        type: CATALOG_IMAGE_CACHE_MESSAGE,
        requestId,
        operation,
        authoritative: authoritative === true,
        paths: approved
      }, [channel.port2]);
      channel.port1.start?.();
    } catch {
      finish(recoveryResult(false, CATALOG_IMAGE_RECOVERY.WORKER_MESSAGE_FAILURE, {
        requestId, present: [], missing: approved
      }));
    }
  });
}

export function requestCatalogImageCache(records, options = {}) {
  return requestCatalogImageCachePaths(catalogImagePaths(records), {
    ...options,
    operation: "synchronize",
    requireController: false
  });
}

function validCachedCatalogImage(response) {
  try {
    return Boolean(response?.ok && response.status >= 200 && response.status < 300 &&
      response.headers?.get("content-type")?.split(";", 1)[0].trim().toLowerCase() === "image/webp");
  } catch {
    return false;
  }
}

function waitForImageSource(image, src, phase, {
  timeoutMs = CATALOG_IMAGE_LOAD_TIMEOUT_MS,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      clearTimer?.(timer);
      image.removeEventListener?.("load", loadedListener);
      image.removeEventListener?.("error", errorListener);
      resolve(loaded);
    };
    const loadedListener = () => finish(true);
    const errorListener = () => finish(false);
    timer = setTimer?.(() => finish(false), timeoutMs);
    image.dataset.catalogImageRecoveryPhase = phase;
    image.addEventListener?.("load", loadedListener, { once: true });
    image.addEventListener?.("error", errorListener, { once: true });
    try {
      image.removeAttribute?.("src");
      image.src = src;
    } catch {
      finish(false);
    }
  });
}

function cacheRetryDelay(delayMs, setTimer = globalThis.setTimeout) {
  if (!delayMs || !setTimer) return Promise.resolve();
  return new Promise((resolve) => setTimer(resolve, delayMs));
}

export async function recoverCatalogImageFromCache(image, path, {
  cacheStorage = globalThis.caches,
  origin = globalThis.location?.origin,
  createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
  cacheAttempts = 2,
  cacheRetryDelayMs = 60,
  cacheOperationTimeoutMs = 1200,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  imageLoadTimeoutMs = CATALOG_IMAGE_LOAD_TIMEOUT_MS
} = {}) {
  if (!image || !path || !isValidCatalogImageUrl(path)) return recoveryResult(false, CATALOG_IMAGE_RECOVERY.INVALID_PATH);
  if (!cacheStorage?.open || !origin || !createObjectURL) return recoveryResult(false, CATALOG_IMAGE_RECOVERY.CACHE_UNAVAILABLE);

  let lastReason = CATALOG_IMAGE_RECOVERY.CACHE_MISS;
  for (let attempt = 1; attempt <= cacheAttempts; attempt += 1) {
    const cacheResult = await boundedPromise((async () => {
      const cache = await cacheStorage.open(CATALOG_IMAGE_CACHE_NAME);
      return cache.match(new URL(path, origin).href, { ignoreVary: true });
    })(), cacheOperationTimeoutMs, CATALOG_IMAGE_RECOVERY.CACHE_OPEN_FAILURE, { setTimer, clearTimer }, CATALOG_IMAGE_RECOVERY.CACHE_OPEN_FAILURE);
    if (!cacheResult.ok) {
      lastReason = cacheResult.reason;
      if (attempt < cacheAttempts) await cacheRetryDelay(cacheRetryDelayMs, setTimer);
      continue;
    }
    const cached = cacheResult.value;
    if (!cached) {
      lastReason = CATALOG_IMAGE_RECOVERY.CACHE_MISS;
      if (attempt < cacheAttempts) await cacheRetryDelay(cacheRetryDelayMs, setTimer);
      continue;
    }
    if (!validCachedCatalogImage(cached)) return recoveryResult(false, CATALOG_IMAGE_RECOVERY.INVALID_RESPONSE_MIME);

    const blobResult = await boundedPromise(Promise.resolve().then(() => cached.blob()), cacheOperationTimeoutMs,
      CATALOG_IMAGE_RECOVERY.BLOB_CONVERSION_FAILURE, { setTimer, clearTimer }, CATALOG_IMAGE_RECOVERY.BLOB_CONVERSION_FAILURE);
    if (!blobResult.ok) {
      return recoveryResult(false, CATALOG_IMAGE_RECOVERY.BLOB_CONVERSION_FAILURE);
    }
    const blob = blobResult.value;
    if (blob?.type?.toLowerCase() !== "image/webp") return recoveryResult(false, CATALOG_IMAGE_RECOVERY.INVALID_RESPONSE_MIME);

    let objectUrl;
    try {
      objectUrl = createObjectURL(blob);
    } catch {
      return recoveryResult(false, CATALOG_IMAGE_RECOVERY.BLOB_CONVERSION_FAILURE);
    }
    const loaded = await waitForImageSource(image, objectUrl, "blob", {
      timeoutMs: imageLoadTimeoutMs, setTimer, clearTimer
    });
    try { revokeObjectURL?.(objectUrl); } catch { /* Revocation failure must not change the rendered result. */ }
    return loaded
      ? recoveryResult(true, CATALOG_IMAGE_RECOVERY.RECOVERED_BLOB, { attempts: attempt })
      : recoveryResult(false, CATALOG_IMAGE_RECOVERY.BLOB_LOAD_DECODE_FAILURE, { attempts: attempt });
  }
  return recoveryResult(false, lastReason, { attempts: cacheAttempts });
}

export async function handleCatalogImageError(event, path, dependencies = {}) {
  const image = event.currentTarget;
  const phase = image?.dataset?.catalogImageRecoveryPhase;
  if (!image || phase === "recovering" || phase === "retrying" || phase === "blob") {
    return recoveryResult(false, CATALOG_IMAGE_RECOVERY.RECOVERY_IN_PROGRESS);
  }
  if (phase === "terminal") {
    image.style.display = "none";
    return recoveryResult(false, image.dataset.catalogImageRecoveryReason || CATALOG_IMAGE_RECOVERY.RECOVERY_EXHAUSTED);
  }
  if (!path || !isValidCatalogImageUrl(path)) {
    image.style.display = "none";
    image.dataset.catalogImageRecoveryPhase = "terminal";
    image.dataset.catalogImageRecoveryReason = CATALOG_IMAGE_RECOVERY.INVALID_PATH;
    return recoveryResult(false, CATALOG_IMAGE_RECOVERY.INVALID_PATH);
  }

  image.dataset.catalogImageRecoveryPhase = "recovering";
  const probe = dependencies.probeCatalogImageCache || requestCatalogImageCachePaths;
  let probeResult;
  try {
    probeResult = await probe([path], {
      ...dependencies,
      operation: "probe",
      requireController: true
    });
  } catch {
    probeResult = recoveryResult(false, CATALOG_IMAGE_RECOVERY.WORKER_MESSAGE_FAILURE, { present: [], missing: [path] });
  }

  if (probeResult.ok && probeResult.present?.includes(path)) {
    const loaded = await waitForImageSource(image, path, "retrying", {
      timeoutMs: dependencies.imageLoadTimeoutMs,
      setTimer: dependencies.setTimer,
      clearTimer: dependencies.clearTimer
    });
    if (loaded) {
      image.dataset.catalogImageRecoveryPhase = "recovered";
      image.dataset.catalogImageRecoveryReason = CATALOG_IMAGE_RECOVERY.RECOVERED_NORMAL_URL;
      return recoveryResult(true, CATALOG_IMAGE_RECOVERY.RECOVERED_NORMAL_URL);
    }
  }

  image.dataset.catalogImageRecoveryPhase = "recovering";
  const blobResult = await recoverCatalogImageFromCache(image, path, dependencies);
  if (blobResult.ok) {
    image.dataset.catalogImageRecoveryPhase = "recovered";
    image.dataset.catalogImageRecoveryReason = blobResult.reason;
    return blobResult;
  }

  image.dataset.catalogImageRecoveryPhase = "terminal";
  image.dataset.catalogImageRecoveryReason = blobResult.reason || probeResult.reason || CATALOG_IMAGE_RECOVERY.RECOVERY_EXHAUSTED;
  image.style.display = "none";
  return recoveryResult(false, image.dataset.catalogImageRecoveryReason, { probeReason: probeResult.reason });
}
