export type TavilyExtractDepth = "basic" | "advanced";

export interface TavilyExtractRequest {
  urls: string[];
  query?: string;
  extractDepth?: TavilyExtractDepth;
  chunksPerSource?: number;
}

export interface TavilyExtractResultItem {
  url: string;
  title?: string | null;
  rawContent: string;
  images?: string[];
  favicon?: string;
}

export interface TavilyExtractFailedResult {
  url: string;
  error: string;
}

export interface TavilyExtractResult {
  results: TavilyExtractResultItem[];
  failedResults: TavilyExtractFailedResult[];
  responseTime?: number;
  usage?: {
    credits: number;
  };
  requestId?: string;
}

export type TavilyExtractCall = TavilyExtractRequest & {
  apiKey: string;
};

export type TavilyExtractOutcome =
  | {
      ok: true;
      data: TavilyExtractResult;
    }
  | {
      ok: false;
      retryable: boolean;
      error?: unknown;
    };

export type TavilyExtractFunction = (
  request: TavilyExtractCall
) => Promise<TavilyExtractOutcome>;

export interface TavilyKeyRing {
  readonly size: number;
  getCurrentKey(): string | undefined;
  rotateAfterFailure(apiKey: string): void;
  redact(value: string): string;
}

export interface TavilyExtractDeps {
  keyRing: TavilyKeyRing;
  extract?: TavilyExtractFunction;
}

type TavilyClientExtractOptions = {
  extractDepth?: TavilyExtractDepth;
  format: "markdown";
  query?: string;
  chunksPerSource?: number;
};

type TavilyExtractOptionInput = {
  query: string | undefined;
  extractDepth: TavilyExtractDepth | undefined;
  chunksPerSource: number | undefined;
};

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ERR_NETWORK"
]);

export function createTavilyKeyRing(keys: readonly string[]): TavilyKeyRing {
  const normalizedKeys = keys.map((key) => key.trim()).filter(Boolean);
  let currentIndex = 0;

  return {
    get size() {
      return normalizedKeys.length;
    },
    getCurrentKey() {
      return normalizedKeys[currentIndex];
    },
    rotateAfterFailure(apiKey: string) {
      const failedIndex = normalizedKeys.indexOf(apiKey);
      if (failedIndex >= 0) {
        currentIndex = (failedIndex + 1) % normalizedKeys.length;
      }
    },
    redact(value: string) {
      return redactKnownValues(value, normalizedKeys);
    }
  };
}

export async function extractOfficialSourceWithTavily(
  request: TavilyExtractRequest,
  deps: TavilyExtractDeps
): Promise<TavilyExtractResult> {
  const extract = deps.extract ?? extractWithDefaultTavilyClient;
  let attempts = 0;
  let lastError: unknown;

  for (let keyAttempt = 0; keyAttempt < deps.keyRing.size; keyAttempt += 1) {
    const apiKey = deps.keyRing.getCurrentKey();
    if (!apiKey) {
      break;
    }

    attempts += 1;
    const outcome = await runExtract(extract, request, apiKey);

    if (outcome.ok) {
      return outcome.data;
    }

    lastError = outcome.error;
    if (!outcome.retryable) {
      break;
    }

    deps.keyRing.rotateAfterFailure(apiKey);
  }

  throw new Error(buildFailureMessage(attempts, lastError, deps.keyRing));
}

async function extractWithDefaultTavilyClient({
  apiKey,
  urls,
  query,
  extractDepth,
  chunksPerSource
}: TavilyExtractCall): Promise<TavilyExtractOutcome> {
  try {
    const { tavily } = await import("@tavily/core");
    const client = tavily({ apiKey });
    const options = buildExtractOptions({ query, extractDepth, chunksPerSource });
    const data = await client.extract(urls, options);

    return {
      ok: true,
      data
    };
  } catch (error) {
    return {
      ok: false,
      retryable: isRetryableError(error),
      error
    };
  }
}

async function runExtract(
  extract: TavilyExtractFunction,
  request: TavilyExtractRequest,
  apiKey: string
): Promise<TavilyExtractOutcome> {
  try {
    return await extract({ ...request, apiKey });
  } catch (error) {
    return {
      ok: false,
      retryable: false,
      error
    };
  }
}

function buildExtractOptions({
  query,
  extractDepth,
  chunksPerSource
}: TavilyExtractOptionInput): TavilyClientExtractOptions {
  const options: TavilyClientExtractOptions = {
    format: "markdown"
  };

  if (query !== undefined) {
    options.query = query;
  }
  if (extractDepth !== undefined) {
    options.extractDepth = extractDepth;
  }
  if (chunksPerSource !== undefined) {
    options.chunksPerSource = chunksPerSource;
  }

  return options;
}

function buildFailureMessage(
  attempts: number,
  lastError: unknown,
  keyRing: TavilyKeyRing
): string {
  const attemptLabel = attempts === 1 ? "1 key attempt" : `${attempts} key attempts`;
  const lastErrorText = errorToMessage(lastError);
  if (!lastErrorText) {
    return `Tavily extraction failed after ${attemptLabel}`;
  }

  return `Tavily extraction failed after ${attemptLabel}. Last error: ${keyRing.redact(
    lastErrorText
  )}`;
}

function isRetryableError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode !== undefined) {
    return RETRYABLE_STATUS_CODES.has(statusCode);
  }

  const errorCode = getErrorCode(error);
  return errorCode !== undefined && RETRYABLE_ERROR_CODES.has(errorCode);
}

function getStatusCode(error: unknown): number | undefined {
  if (!isObject(error)) {
    return undefined;
  }

  const directStatus = getNumberProperty(error, "status");
  if (directStatus !== undefined) {
    return directStatus;
  }

  const response = getObjectProperty(error, "response");
  if (!response) {
    return undefined;
  }

  return getNumberProperty(response, "status");
}

function getErrorCode(error: unknown): string | undefined {
  if (!isObject(error)) {
    return undefined;
  }

  const code = error["code"];
  return typeof code === "string" ? code : undefined;
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error === undefined || error === null) {
    return "";
  }

  return String(error);
}

function getNumberProperty(
  value: Record<string, unknown>,
  property: string
): number | undefined {
  const propertyValue = value[property];
  return typeof propertyValue === "number" ? propertyValue : undefined;
}

function getObjectProperty(
  value: Record<string, unknown>,
  property: string
): Record<string, unknown> | undefined {
  const propertyValue = value[property];
  return isObject(propertyValue) ? propertyValue : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function redactKnownValues(value: string, values: readonly string[]): string {
  return values
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, secret) => redacted.split(secret).join("[REDACTED_TAVILY_KEY]"),
      value
    );
}
