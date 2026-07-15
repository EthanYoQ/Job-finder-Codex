import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_sanofi_china = {
  companyId: "company-sanofi-china",
  sources: [
    {
      sourceId: "source-sanofi-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
              completenessProof: { kind: "CONFIGURED_CHANNEL_TRAVERSAL" },
              pagination: {
                  totalPagesSelector: "#search-results",
                  totalPagesAttribute: "data-total-pages",
                  pageSearchParam: "page",
                  pageUrlTemplate: "https://jobs.sanofi.com/en/location/china-jobs/2649/1814991/2/{page}",
                  maxPages: 25,
                  expectedJobCountSelector: "#search-results",
                  expectedJobCountAttribute: "data-total-job-results",
                  ajaxMode: "talentbrew",
                  talentbrewScope: {
                      requiredActiveFacet: { id: "1814991", facetType: 2, descriptor: "China" },
                      allowedPartitions: [
                          { channelId: "employment-fixed-term", id: "Fixed Term (Fixed Term)", facetType: 5,
                              fieldName: "job_type", descriptor: "Fixed Term (Fixed Term)" },
                          { channelId: "employment-regular", id: "Regular", facetType: 5,
                              fieldName: "job_type", descriptor: "Regular" }
                      ],
                      excludedPartitions: [
                          { id: "Apprentice/Intern", facetType: 5,
                              fieldName: "job_type", descriptor: "Apprentice/Intern" },
                          { id: "Apprentice/Intern (Fixed Term)", facetType: 5,
                              fieldName: "job_type", descriptor: "Apprentice/Intern (Fixed Term)" },
                          { id: "Student (Fixed Term)", facetType: 5,
                              fieldName: "job_type", descriptor: "Student (Fixed Term)" }
                      ]
                  }
              },
              fields: {
                  sourceJobId: { selector: "button.js-save-job-btn", attribute: "data-job-id" },
                  officialTitle: { selector: "h2" },
                  officialUrl: { selector: "a[href*='/job/']", attribute: "href" },
                  locationRaw: { selector: "span.job-location" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
