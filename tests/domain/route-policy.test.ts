import { describe, expect, it } from "vitest";
import {
  canAccessWithoutConsent,
  isIndexableRoute,
  shouldLoadOperationalAnalytics
} from "../../src/domain/route-policy";

describe("privacy consent route policy", () => {
  it("allows policy and terms before consent", () => {
    expect(canAccessWithoutConsent("/privacy")).toBe(true);
    expect(canAccessWithoutConsent("/terms")).toBe(true);
  });

  it("allows only the static homepage shell before consent", () => {
    expect(canAccessWithoutConsent("/")).toBe(true);
    expect(canAccessWithoutConsent("/companies")).toBe(false);
    expect(canAccessWithoutConsent("/search?city=北京")).toBe(false);
  });

  it("does not load operational analytics before consent", () => {
    expect(shouldLoadOperationalAnalytics("/", false)).toBe(false);
    expect(shouldLoadOperationalAnalytics("/search", false)).toBe(false);
    expect(shouldLoadOperationalAnalytics("/search", true)).toBe(true);
  });
});

describe("SEO route policy", () => {
  it("indexes only minimal static routes", () => {
    expect(isIndexableRoute("/")).toBe(true);
    expect(isIndexableRoute("/privacy")).toBe(true);
    expect(isIndexableRoute("/terms")).toBe(true);
  });

  it("does not index result pages, APIs, admin, or deep data paths", () => {
    expect(isIndexableRoute("/search")).toBe(false);
    expect(isIndexableRoute("/city/beijing/category/sales")).toBe(false);
    expect(isIndexableRoute("/api/search")).toBe(false);
    expect(isIndexableRoute("/admin")).toBe(false);
    expect(isIndexableRoute("/companies")).toBe(false);
  });
});
