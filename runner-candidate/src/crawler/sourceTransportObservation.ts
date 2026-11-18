import { AsyncLocalStorage } from "node:async_hooks";
import { parseOfficialRetryAfter } from "./officialRetryAfter";
import { withWorkdayTransportObservation } from "./workdayRequestPolicy";

/** Scheduling facts from actual responses and local policy, never classification or replay. */
export interface SourceTransportObservation {
  sourceId: string;
  observedAt: number;
  observedActualHttp: boolean;
  actualHttpStatuses: number[];
  lastActualRequestAt?: number;
  locallyDeferred: boolean;
  deferredStatus?: 403 | 429;
  retryAt?: number;
  retryAfterMs?: number;
}

const transportObservations = new AsyncLocalStorage<SourceTransportObservation>();
const observationCallbacks = new WeakMap<SourceTransportObservation, (observation: SourceTransportObservation) => void>();

export async function withSourceTransportObservation<T>(
  sourceId: string,
  observe: ((observation: SourceTransportObservation) => void) | undefined,
  run: () => Promise<T>
): Promise<T> {
  if (!observe && transportObservations.getStore()?.sourceId === sourceId) return run();
  const observation: SourceTransportObservation = { sourceId, observedAt: Date.now(),
    observedActualHttp: false, actualHttpStatuses: [], locallyDeferred: false };
  if (observe) observationCallbacks.set(observation, observe);
  try {
    return await transportObservations.run(observation, () => withWorkdayTransportObservation(event => {
      if (event.kind === "LOCAL_DEFERRED") {
        observation.locallyDeferred = true;
        observation.deferredStatus = event.status;
        retainRetryFloor(observation, event.observedAt, event.retryAt);
      } else {
        recordActualHttpFailure(observation, event.status, event.observedAt, event.retryAt);
      }
    }, run));
  } finally {
    if (observation.observedActualHttp || observation.locallyDeferred) {
      publishObservation(observation);
    }
  }
}

export function currentSourceTransportRetryAt(): number | undefined {
  return transportObservations.getStore()?.retryAt;
}

export class OfficialRequestDeferredError extends Error {
  readonly code = "OFFICIAL_REQUEST_DEFERRED";
  constructor(readonly retryAt: number) {
    super("Official recruitment request deferred until the existing retry deadline");
    this.name = "OfficialRequestDeferredError";
  }
}

/** No new request is sent, and the existing absolute deadline is never extended. */
export function assertSourceTransportAvailable(): void {
  const observation = transportObservations.getStore();
  const now = Date.now();
  if (!observation || observation.retryAt === undefined || observation.retryAt <= now) return;
  observation.locallyDeferred = true;
  retainRetryFloor(observation, now);
  throw new OfficialRequestDeferredError(observation.retryAt);
}

/** Relay only parsed observations from the current source's live isolated child. */
export function recordIsolatedSourceTransportObservation(incoming: SourceTransportObservation): void {
  const observation = transportObservations.getStore();
  if (!observation || observation.sourceId !== incoming.sourceId) return;
  const statuses = incoming.actualHttpStatuses.filter(status => Number.isInteger(status) &&
    (status === 403 || status === 429 || status >= 500 && status <= 599));
  if (incoming.observedActualHttp && statuses.length > 0) {
    observation.observedActualHttp = true;
    for (const status of statuses) {
      if (!observation.actualHttpStatuses.includes(status)) observation.actualHttpStatuses.push(status);
    }
    if (incoming.lastActualRequestAt !== undefined && Number.isSafeInteger(incoming.lastActualRequestAt)) {
      observation.lastActualRequestAt = Math.max(observation.lastActualRequestAt ?? 0, incoming.lastActualRequestAt);
    }
  }
  if (incoming.locallyDeferred) {
    observation.locallyDeferred = true;
    if (incoming.deferredStatus === 403 || incoming.deferredStatus === 429) observation.deferredStatus = incoming.deferredStatus;
  }
  retainRetryFloor(observation, incoming.observedAt, incoming.retryAt);
}

/** Call only when live transport has received response headers. */
export function recordOfficialHttpResponse(status: number, retryAfter: string | null): void {
  observeResponse(transportObservations.getStore(), status, retryAfter);
}

/** Browser events can arrive on the connection's context; retain the owning source at registration. */
export function bindOfficialHttpResponseObserver(): (status: number, retryAfter: string | null) => void {
  const observation = transportObservations.getStore();
  return (status, retryAfter) => observeResponse(observation, status, retryAfter);
}

function observeResponse(observation: SourceTransportObservation | undefined, status: number, rawRetryAfter: string | null): void {
  if (!observation || !Number.isInteger(status) ||
      !(status === 403 || status === 429 || status >= 500 && status <= 599)) return;
  const now = Date.now();
  const retryAfter = parseOfficialRetryAfter(rawRetryAfter, now);
  recordActualHttpFailure(observation, status, now,
    retryAfter && "delayMs" in retryAfter ? now + retryAfter.delayMs : undefined);
}

function retainRetryFloor(observation: SourceTransportObservation, observedAt: number, retryAt?: number): void {
  const previousRetryAt = observation.retryAt;
  observation.observedAt = Math.max(observation.observedAt, observedAt);
  if (retryAt !== undefined && Number.isSafeInteger(retryAt)) {
    observation.retryAt = Math.max(observation.retryAt ?? 0, retryAt);
  }
  if (observation.retryAt !== undefined) {
    observation.retryAfterMs = Math.max(0, observation.retryAt - observation.observedAt);
  }
  // Persist a longer server/policy deadline before any response body work can block.
  if (observation.retryAt !== undefined && observation.retryAt > (previousRetryAt ?? 0)) publishObservation(observation);
}

function publishObservation(observation: SourceTransportObservation): void {
  observationCallbacks.get(observation)?.({ ...observation, actualHttpStatuses: [...observation.actualHttpStatuses] });
}

function recordActualHttpFailure(observation: SourceTransportObservation, status: number, observedAt: number, retryAt?: number): void {
  observation.observedActualHttp = true;
  observation.lastActualRequestAt = Math.max(observation.lastActualRequestAt ?? 0, observedAt);
  if (!observation.actualHttpStatuses.includes(status)) observation.actualHttpStatuses.push(status);
  retainRetryFloor(observation, observedAt, retryAt);
}
