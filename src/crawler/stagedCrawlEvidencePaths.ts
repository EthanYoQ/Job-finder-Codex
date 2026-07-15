import { isAbsolute, relative, resolve, sep } from "node:path";

export interface StagedCrawlEvidencePaths {
  attemptDir: string;
  summaryPath: string;
  initialQualificationPausePath: string;
}

export function resolveStagedCrawlEvidencePaths(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): StagedCrawlEvidencePaths {
  const outputsRoot = resolve(cwd, "outputs");
  const attemptDir = configuredPath(
    env,
    "STAGED_CRAWL_ATTEMPT_DIR",
    resolve(outputsRoot, "staged-crawl-attempts"),
    cwd
  );
  const summaryPath = configuredPath(
    env,
    "STAGED_CRAWL_SUMMARY_PATH",
    resolve(outputsRoot, "staged-crawl-summary.json"),
    cwd
  );
  const initialQualificationPausePath = configuredPath(
    env,
    "STAGED_INITIAL_QUALIFICATION_PAUSE_PATH",
    resolve(outputsRoot, "staged-initial-qualification-pause.json"),
    cwd
  );

  assertStrictDescendant(outputsRoot, attemptDir, "STAGED_CRAWL_ATTEMPT_DIR");
  assertStrictDescendant(outputsRoot, summaryPath, "STAGED_CRAWL_SUMMARY_PATH");
  assertStrictDescendant(
    outputsRoot,
    initialQualificationPausePath,
    "STAGED_INITIAL_QUALIFICATION_PAUSE_PATH"
  );

  const strictAttemptDir = resolve(outputsRoot, "crawl-attempts");
  const strictSummaryPath = resolve(outputsRoot, "crawl-summary.json");
  if ([attemptDir, summaryPath, initialQualificationPausePath].some((stagedPath) =>
    [strictAttemptDir, strictSummaryPath].some((strictPath) => pathsOverlap(stagedPath, strictPath)))) {
    throw new Error("Staged crawl evidence paths must remain separate from strict evidence paths");
  }
  if (
    pathsOverlap(attemptDir, summaryPath) ||
    pathsOverlap(attemptDir, initialQualificationPausePath) ||
    pathsOverlap(summaryPath, initialQualificationPausePath)
  ) {
    throw new Error("Staged crawl evidence paths must not overlap");
  }

  return { attemptDir, summaryPath, initialQualificationPausePath };
}

function configuredPath(
  env: NodeJS.ProcessEnv,
  name: "STAGED_CRAWL_ATTEMPT_DIR" | "STAGED_CRAWL_SUMMARY_PATH" |
    "STAGED_INITIAL_QUALIFICATION_PAUSE_PATH",
  fallback: string,
  cwd: string
): string {
  const value = env[name];
  if (value === undefined) return fallback;
  assertCanonicalConfiguredPath(value, name);
  return resolve(cwd, value);
}

function assertCanonicalConfiguredPath(value: string, name: string): void {
  if (!value || value !== value.trim() || value.includes("\0")) {
    throw new Error(`${name} must be a canonical path`);
  }
  const segments = value.split(/[\\/]/u);
  const pathSegments = segments[0] === "" ? segments.slice(1) : segments;
  if (pathSegments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${name} must be a canonical path`);
  }
}

function assertStrictDescendant(root: string, candidate: string, name: string): void {
  const pathFromRoot = relative(root, candidate);
  if (
    !pathFromRoot ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`${name} must resolve within the canonical outputs root`);
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function isSameOrDescendant(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}
