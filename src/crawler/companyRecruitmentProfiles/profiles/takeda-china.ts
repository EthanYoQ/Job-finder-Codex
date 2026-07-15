import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_takeda_china = {
  companyId: "company-takeda-china",
  sources: [
    {
      sourceId: "source-takeda-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
              completenessProof: { kind: "CONFIGURED_CHANNEL_TRAVERSAL" },
              pagination: {
                  totalPagesSelector: "#search-results",
                  totalPagesAttribute: "data-total-pages",
                  pageSearchParam: "page",
                  maxPages: 30,
                  expectedJobCountSelector: "#search-results",
                  expectedJobCountAttribute: "data-total-job-results",
                  ajaxMode: "talentbrew",
                  talentbrewScope: {
                      requiredActiveFacet: { id: "1814991", facetType: 2, descriptor: "China" },
                      allowedPartitions: [
                          { channelId: "career-commercial", id: "Commercial", facetType: 5,
                              fieldName: "custom_fields.CategoryField", descriptor: "Commercial" },
                          { channelId: "career-corporate-functions", id: "Corporate Functions", facetType: 5,
                              fieldName: "custom_fields.CategoryField", descriptor: "Corporate Functions" },
                          { channelId: "career-data-digital-technology", id: "Data, Digital & Technology", facetType: 5,
                              fieldName: "custom_fields.CategoryField", descriptor: "Data, Digital & Technology" },
                          { channelId: "career-manufacturing-supply", id: "Manufacturing & Supply", facetType: 5,
                              fieldName: "custom_fields.CategoryField", descriptor: "Manufacturing & Supply" },
                          { channelId: "career-quality", id: "Quality", facetType: 5,
                              fieldName: "custom_fields.CategoryField", descriptor: "Quality" },
                          { channelId: "career-research-development", id: "Research & Development", facetType: 5,
                              fieldName: "custom_fields.CategoryField", descriptor: "Research & Development" }
                      ],
                      excludedPartitions: [
                          { id: "Early Career", facetType: 5,
                              fieldName: "custom_fields.CategoryField", descriptor: "Early Career" }
                      ]
                  }
              },
              fields: {
                  sourceJobId: { selector: "button.js-save-job-btn", attribute: "data-job-id" },
                  officialTitle: { selector: "h2.title" },
                  officialUrl: { selector: "a[href*='/job/']", attribute: "href" },
                  locationRaw: { selector: ".location" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
