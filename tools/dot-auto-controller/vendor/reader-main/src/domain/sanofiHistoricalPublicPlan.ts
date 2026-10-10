import type { SourceCrawlPlan } from "../crawler/sourcePlan";
/** Frozen verification-only plan. Never an acquisition/issuer registration. */
export const SANOFI_HISTORICAL_PUBLIC_PLAN = {
  "adapterId": "html-table",
  "company": {
    "id": "company-sanofi-china",
    "officialChineseName": "赛诺菲中国",
    "category": "FOREIGN_PHARMA"
  },
  "source": {
    "id": "source-sanofi-china-social",
    "surfaceId": "surface-sanofi-china-social",
    "companyId": "company-sanofi-china",
    "kind": "SOCIAL",
    "atsKind": "OFFICIAL_HTML",
    "status": "VERIFIED_SCRAPABLE",
    "officialEntryUrl": "https://jobs.sanofi.com/en/location/china-country-jobs/2649/1814991/2",
    "officialChainEvidenceUrl": "https://jobs.sanofi.cn/"
  },
  "executionAuthority": "STAGED",
  "expectedChannels": [
    {
      "channelId": "source:source-sanofi-china-social:default",
      "kind": "SOCIAL"
    }
  ],
  "expectedChannelSetHash": "5d49337418474180671fffdaf565d04617340e75672baf30668e6dea1ffaf85e",
  "table": {
    "sanofiNativePolicy": "SANOFI_EN_CN_NATIVE_CHAIN_V1",
    "sanofiChineseEntryUrl": "https://jobs.sanofi.cn/%e6%b1%82%e8%81%8c/%E4%B8%AD%E5%9B%BD/2649/2/1814991/35/105/50/2",
    "rowSelector": "#search-results-list li:has(button.js-save-job-btn)",
    "completenessProof": {
      "kind": "OFFICIAL_TOTAL_PAGES"
    },
    "pagination": {
      "totalPagesSelector": "#search-results",
      "totalPagesAttribute": "data-total-pages",
      "pageSearchParam": "page",
      "maxPages": 25,
      "expectedJobCountSelector": "#search-results",
      "expectedJobCountAttribute": "data-total-job-results",
      "ajaxMode": "talentbrew",
      "pageUrlTemplate": "https://jobs.sanofi.com/en/location/china-jobs/2649/1814991/2/{page}"
    },
    "fields": {
      "sourceJobId": {
        "selector": "button.js-save-job-btn",
        "attribute": "data-job-id"
      },
      "officialTitle": {
        "selector": "h2"
      },
      "officialUrl": {
        "selector": "a[href*='/job/']",
        "attribute": "href"
      },
      "locationRaw": {
        "selector": "span.job-location"
      }
    }
  },
  "transientRetryPolicy": {
    "maxRetries": 1,
    "backoffMs": 10000
  },
  "transportPolicy": {
    "primary": "DIRECT_HTTP"
  }
} satisfies SourceCrawlPlan;
