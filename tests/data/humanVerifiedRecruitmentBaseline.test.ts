import { describe, expect, it } from "vitest";
import {
  HUMAN_VERIFIED_RECRUITMENT_BASELINE,
  humanVerifiedCompanyIds
} from "../../src/data/humanVerifiedRecruitmentBaseline";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { P0_LAUNCH_MANIFEST } from "../../src/release/launchManifest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

describe("user-supplied recruitment baseline", () => {
  it("binds the dated workbook provenance and 41 unique in-scope companies", () => {
    expect(HUMAN_VERIFIED_RECRUITMENT_BASELINE.observedOn).toBe("2026-09-02");
    expect(HUMAN_VERIFIED_RECRUITMENT_BASELINE.provenance.workbookSha256).toBe(
      "a325c6009b5f3bfd2308c0a38fcdd783d81b8fcf8c9072ea1c07357b0f31715d"
    );
    expect(humanVerifiedCompanyIds()).toHaveLength(41);
    expect(new Set(humanVerifiedCompanyIds())).toHaveProperty("size", 41);
  });

  it("contains only registered companies and defines the complete launch scope", () => {
    const registeredIds = new Set(candidateCompanies.map(({ id }) => id));
    expect(humanVerifiedCompanyIds().filter((companyId) => !registeredIds.has(companyId))).toEqual([]);
    expect(P0_LAUNCH_MANIFEST.companies.map(({ companyId }) => companyId)).toEqual(
      humanVerifiedCompanyIds()
    );
  });

  it("keeps unknown observations explicit instead of inventing a zero", () => {
    const unknown = HUMAN_VERIFIED_RECRUITMENT_BASELINE.companies.filter(([, count]) => count === null);
    expect(unknown).toEqual([
      ["company-cr-pharma", null, null, "No unique public filter could be verified; keep the result UNKNOWN."]
    ]);
  });

  it("keeps the dated human snapshot outside all production source dependencies", () => {
    const srcRoot = join(process.cwd(), "src");
    const imports = sourceFiles(srcRoot)
      .filter((file) => !file.endsWith("humanVerifiedRecruitmentBaseline.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("humanVerifiedRecruitmentBaseline"));
    expect(imports).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}
