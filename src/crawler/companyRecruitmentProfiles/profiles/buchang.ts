import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_buchang = {
  companyId: "company-buchang",
  sources: [
    {
      sourceId: "source-buchang-social",
      executionConfig: {
        adapterId: "html-table",
        table: {
          rowSelector: "table.Ju-ZhaoPin tr[class^='main_']:has(td:first-child a[href*='ZhaoPinDetial.aspx?ID='])",
          completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
          fields: {
            sourceJobId: {
              selector: "td:first-child a",
              attribute: "href",
              pattern: "[?&]ID=([0-9a-fA-F-]{36})(?:&|$)"
            },
            officialTitle: { selector: "td:first-child a" },
            officialUrl: { selector: "td:first-child a", attribute: "href" },
            locationRaw: { value: "未披露" }
          },
          pagination: {
            totalPagesSelector: "#drop1 option[value]:not([value='请选择'])",
            totalPagesAttribute: "value",
            totalPagesMode: "max",
            pageSearchParam: "page",
            maxPages: 1,
            expectedJobCountSelector: "#totallcount",
            expectedJobCountPattern: "^\\s*(\\d+)\\s*$"
          }
        }
      }
    }
  ]
} satisfies CompanyRecruitmentProfileSeed;
