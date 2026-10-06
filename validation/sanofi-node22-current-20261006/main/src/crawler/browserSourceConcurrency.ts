const DEFAULT_BROWSER_SOURCE_CONCURRENCY = 1;

let active = 0;
const waiters: Array<(release: () => void) => void> = [];

export async function acquireBrowserSourcePermit(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) throw signal.reason ?? new Error("Browser source permit aborted");
  if (active < DEFAULT_BROWSER_SOURCE_CONCURRENCY) {
    active += 1;
    return makeRelease();
  }
  return new Promise<() => void>((resolve, reject) => {
      const grant = (release: () => void) => {
        signal?.removeEventListener("abort", abort);
        resolve(release);
      };
      const abort = () => {
        const index = waiters.indexOf(grant);
        if (index >= 0) waiters.splice(index, 1);
        reject(signal?.reason ?? new Error("Browser source permit aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      waiters.push(grant);
  });
}

function makeRelease(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiters.shift();
    if (next) next(makeRelease());
    else active -= 1;
  };
}
