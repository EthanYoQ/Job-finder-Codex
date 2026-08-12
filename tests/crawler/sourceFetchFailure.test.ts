import { describe, expect, it } from "vitest";
import {
  retryableHttpTransportFailure,
  retryableTransportFailureFromError
} from "../../src/crawler/sourceFetchFailure";
import { transportFailureDiagnosticBundle } from "../../src/crawler/sourceFailureDiagnostics";

describe("source transport retry classification", () => {
  it.each([429, 500, 501, 502, 503, 504, 599])("allows transient HTTP status %s", (status) => {
    expect(retryableHttpTransportFailure(status)).toEqual({
      code: `OFFICIAL_HTTP_${status}`,
      retryable: true
    });
  });

  it.each([400, 401, 403, 404, 422, 600])("does not retry non-transient HTTP status %s", (status) => {
    expect(retryableHttpTransportFailure(status)).toBeUndefined();
  });

  it("does not convert configuration or parse errors into retries", () => {
    expect(retryableTransportFailureFromError(new Error("JSON parse failed"))).toBeUndefined();
    expect(retryableTransportFailureFromError(new Error("pagination config invalid"))).toBeUndefined();
  });

  it("persists a bounded generic diagnostic for any other retryable 5xx status", () => {
    expect(transportFailureDiagnosticBundle(
      retryableHttpTransportFailure(599),
      { fetchAttemptCount: 2, retryCount: 1, retryReasonCodes: ["OFFICIAL_HTTP_599"] }
    )).toEqual({
      failureCategory: "TEMPORARY_OFFICIAL_SOURCE_FAILURE",
      failureDiagnosticCode: "OFFICIAL_HTTP_5XX",
      fetchAttemptCount: 2,
      retryCount: 1,
      retryReasonCodes: ["OFFICIAL_HTTP_599"]
    });
  });
});
