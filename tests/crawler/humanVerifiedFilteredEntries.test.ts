import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildDiscoverySourcePlanCandidates, getPlanBySourceId } from "../../src/crawler/sourcePlan";

function company(id: string) {
  const found = candidateCompanies.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing company ${id}`);
  return found;
}

describe("human-verified official filter entry contracts", () => {
  it("uses Novartis China's explicit mainland-China and all-posting-date filter", () => {
    const plan = getPlanBySourceId(
      buildDiscoverySourcePlanCandidates([company("company-novartis")]),
      "source-novartis-social"
    );
    if (!plan) throw new Error("Missing Novartis plan");

    const entry = new URL(plan.source.officialEntryUrl);
    expect(entry.origin).toBe("https://www.novartis.com.cn");
    expect(entry.searchParams.getAll("country[0]")).toEqual(["LOC_CN"]);
    expect(entry.searchParams.get("field_job_posted_date")).toBe("All");
  });

  it("retains Kelun's manually selected marketing category on every HTML page", () => {
    const plan = getPlanBySourceId(
      buildDiscoverySourcePlanCandidates([company("company-kelun")]),
      "source-kelun-social"
    );
    if (!plan || plan.adapterId !== "html-table") throw new Error("Missing Kelun HTML plan");

    const entry = new URL(plan.source.officialEntryUrl);
    expect(entry.origin).toBe("https://kelun.zhiye.com");
    expect(entry.searchParams.get("p")).toBe("1^2");
    expect(plan.table.pagination?.pageSearchParam).toBe("PageIndex");
  });
});
