import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_qilu = {
  companyId: "company-qilu",
  sources: [
    {
      sourceId: "source-qilu-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: ".e_loop-65 .cbox-65.p_loopitem",
              completenessProof: {
                  kind: "STATIC_PUBLIC_LIST"
              },
              staticPublicList: {
                  containerSelector: ".e_loop-65",
                  nextControlSelector: ".p_page .page_next:not(.disabled)"
              },
              fields: {
                  officialTitle: { selector: ".e_text-83 a" },
                  officialUrl: { selector: ".e_text-83 a", attribute: "href" },
                  locationRaw: { selector: ".e_text-86" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
