import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_livzon = {
  companyId: "company-livzon",
  sources: [
    {
      sourceId: "source-livzon-social",
      executionConfig: {
        adapterId: "html-table",
        table: {
          rowSelector: "#c_product_list_041-17354888079290 .p_list > .p_loopitem",
          rowFilter: {
            selector: ".e_richText-11",
            pattern: "^(?:岗位职责|任职资格|任职要求)",
            requireAllCandidatesForCompleteness: true
          },
          completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
          pagination: {
            totalPagesSelector: ".p_page .page_num",
            totalPagesAttribute: "data-page-number",
            totalPagesPattern: "^\\s*([1-9]\\d*)\\s*$",
            totalPagesMode: "max",
            pageSearchParam: "offset",
            pageSearchParamMode: "offset",
            pageUrlTemplate: "https://www.livzon.com.cn/Social_list/p-{page}-6.html",
            pageSize: 6,
            maxPages: 200,
            strictPageControls: {
              containerSelector: ".p_page .page_con",
              pageNumberSelector: "a.page_num",
              currentPageSelector: "a.page_num.current",
              previousPageSelector: "a.page_prev",
              nextPageSelector: "a.page_next",
              disabledClass: "disabled",
              currentHref: "javascript:;"
            }
          },
          fields: {
            officialTitle: { selector: ".e_text-5 a" },
            officialUrl: { selector: ".e_text-5 a", attribute: "href" },
            locationRaw: { value: "未披露" }
          }
        }
      }
    }
  ]
} satisfies CompanyRecruitmentProfileSeed;
