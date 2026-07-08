import { describe, expect, it } from "vitest";
import { getStaticDocument } from "../../src/server/staticDocuments";

describe("static policy documents", () => {
  it("serves consent-safe privacy and terms text with anti-crawl language", () => {
    expect(getStaticDocument("privacy").body).toContain("跨境合规事项仍需法律复核");
    expect(getStaticDocument("terms").body).toContain("禁止抓取、批量复制、转售或商业化复用");
  });
});
