import type { CompanyRecruitmentProfileSeed } from "../types";
import { CHROME_LIKE_HTML_REQUEST_HEADERS } from "../shared";

export const profile_astellas_china = {
  companyId: "company-astellas-china",
  sources: [
    {
      sourceId: "source-astellas-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "a[href$='.pdf'][href*='/global/zh/']",
              completenessProof: {
                  kind: "STATIC_PUBLIC_LIST",
                  sourcePolicy: "ASTELLAS_CHINA_PDF_ACCORDION_V1"
              },
              staticPublicList: {
                  containerSelector: ".cmp-accordion[data-cmp-is='accordion']",
                  nextControlSelector: ".pagination, a[rel='next'], [data-page]"
              },
              fields: {
                  sourceJobId: {
                      selector: ":scope",
                      attribute: "href",
                      pattern: "/([^/]+)\\.pdf$"
                  },
                  officialTitle: { selector: "span:first-child" },
                  officialUrl: { selector: ":scope", attribute: "href" },
                  locationRaw: { value: "中国" }
              },
              defaultCategory: "其他",
              requestHeaders: CHROME_LIKE_HTML_REQUEST_HEADERS
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
