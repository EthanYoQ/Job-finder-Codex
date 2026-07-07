import { describe, expect, it } from "vitest";
import "../../src/domain/company";
import type { Company, RecruitmentSource } from "../../src/domain/company";

describe("company source domain", () => {
  it("represents a company with official social and campus source separation", () => {
    const socialSource: RecruitmentSource = {
      id: "source-hengrui-social",
      companyId: "company-hengrui",
      kind: "SOCIAL",
      atsKind: "MOKA",
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/careers",
      status: "VERIFIED_SCRAPABLE"
    };

    const company: Company = {
      id: "company-hengrui",
      officialChineseName: "江苏恒瑞医药股份有限公司",
      officialWebsiteUrl: "https://www.hengrui.com",
      pinyinName: "jiang su heng rui yi yao gu fen you xian gong si",
      inclusionReason: "国内头部药企、已实测",
      sources: [socialSource]
    };

    expect(company.sources[0]?.kind).toBe("SOCIAL");
    expect(company.sources[0]?.status).toBe("VERIFIED_SCRAPABLE");
  });
});
