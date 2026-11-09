import type { JobCategory } from "./search";
import type { JOB_CATEGORY_GROUPS, JobClassification } from "./jobClassification";

type RecognizedCategory = Exclude<JobCategory, "其他">;
type ResponsibilityClassification = {
  [Category in RecognizedCategory]: {
    category: Category;
    subcategory?: (typeof JOB_CATEGORY_GROUPS)[Category][number];
  }
}[RecognizedCategory];

export interface JobClassificationEvidence {
  department?: RecognizedCategory;
  responsibilities?: ResponsibilityClassification;
}

interface VerifiedJobEvidence extends JobClassificationEvidence {
  sourceId: string;
  requisitionId: string;
}

// 2026-11-06 native detail archives b8cc1765/a2f5b911 agree on Sales metadata and product/customer/market duties.
const SANOFI_SALES_REQUISITIONS = [
  "R2877042", "R2876733", "R2877031", "R2877048", "R2877056", "R2876743",
  "R2877030", "R2877041", "R2876725", "R2876765", "R2877045", "R2876732",
  "R2876709", "R2876727", "R2877047", "R2876734", "R2877046", "R2876741",
  "R2877044", "R2877038", "R2876790", "R2877049", "R2877050", "R2876748",
  "R2877040", "R2876802", "R2876715", "R2877043", "R2877149", "R2877152",
  "R2877153", "R2877148", "R2877145", "R2877039", "R2877054", "R2877057",
  "R2877055", "R2877061", "R2877053", "R2876773", "R2876758", "R2876764",
  "R2876760", "R2876824", "R2876769", "R2876759", "R2876761", "R2876899",
  "R2877279", "R2877296", "R2877297", "R2877290", "R2877280", "R2877285",
  "R2877289", "R2877294", "R2877293", "R2877284", "R2877287", "R2877295",
  "R2877292", "R2876754", "R2876507", "R2876225", "R2877347", "R2874482",
  "R2877361", "R2877121", "R2877066", "R2877067", "R2877068", "R2877069",
  "R2877070", "R2877071", "R2877072", "R2877120", "R2877074", "R2877075",
  "R2877122", "R2876707", "R2876706", "R2877076", "R2876079", "R2876916",
  "R2877111", "R2877112", "R2877116", "R2877117", "R2877136", "R2877129",
  "R2877118", "R2877119", "R2877115", "R2877123", "R2876814", "R2865072",
  "R2876353", "R2877449", "R2877113", "R2876602", "R2877086", "R2877138",
  "R2876217", "R2876573", "R2877140", "R2877073", "R2877079", "R2877085",
  "R2877612", "R2877272", "R2876219", "R2877077", "R2877080", "R2877132",
  "R2877133", "R2877134", "R2877139", "R2877281", "R2876520", "R2877078",
  "R2877244", "R2877082", "R2877083", "R2877084", "R2877137", "R2876978",
  "R2876097", "R2875633", "R2876935", "R2876241", "R2875755", "R2875846",
  "R2875247", "R2875688",
  // The current Senior posting (Sanofi 46411104896) confirms the same requisition, Sales category and field sales duties.
  "R2876712"
];
// The 27-position official archive joins public URLs to ATS IDs; its department labels are therapeutic areas, so use duties.
const BMS_REQUISITIONS: Readonly<Record<string, string>> = {
  "137483498818": "R1606504",
  "137482757395": "R1604256",
  "137482105934": "R1604247",
  "137484127711": "R1607799",
  "137484350598": "R1608200"
};

const VERIFIED_JOB_EVIDENCE: readonly VerifiedJobEvidence[] = [
  {
    sourceId: "source-roche-china-social",
    requisitionId: "202608-121967",
    department: "生产/工程",
    responsibilities: { category: "生产/工程", subcategory: "MSAT 技术转移" }
  },
  ...SANOFI_SALES_REQUISITIONS.map((requisitionId): VerifiedJobEvidence => ({
    sourceId: "source-sanofi-china-social",
    requisitionId,
    department: "销售",
    responsibilities: { category: "销售", subcategory: "医药销售" }
  })),
  {
    sourceId: "source-sanofi-china-social",
    requisitionId: "R2877032",
    department: "销售"
  },
  ...Object.values(BMS_REQUISITIONS).map((requisitionId): VerifiedJobEvidence => ({
    sourceId: "source-bms-china-social",
    requisitionId,
    responsibilities: { category: "销售", subcategory: "医药销售" }
  })),
  {
    sourceId: "source-novartis-social",
    requisitionId: "REQ-10087785",
    department: "销售",
    responsibilities: { category: "销售", subcategory: "培训与赋能" }
  },
  // Official functional pages from batch 39f4c970: FCT_CM, FCT_SA and FCT_RD.
  { sourceId: "source-novartis-social", requisitionId: "REQ-10090075", department: "职能" },
  { sourceId: "source-novartis-social", requisitionId: "REQ-10090555", department: "销售" },
  { sourceId: "source-novartis-social", requisitionId: "REQ-10090556", department: "销售" },
  { sourceId: "source-novartis-social", requisitionId: "REQ-10090557", department: "销售" },
  { sourceId: "source-novartis-social", requisitionId: "REQ-10086238", department: "研发/科学" },
  { sourceId: "source-novartis-social", requisitionId: "REQ-10090055", department: "研发/科学" }
];

function nativeRequisitionId(sourceId: string, officialUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(officialUrl);
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;

  if (sourceId === "source-sanofi-china-social" && url.origin === "https://www.ajinga.com") {
    return /^\/ats\/job-detail-new\/13537\/(R\d+)\/c\/?$/.exec(url.pathname)?.[1];
  }
  if (sourceId === "source-bms-china-social") {
    if (url.origin === "https://jobs.bms.com") {
      const publicId = /^\/careers\/job\/(\d+)\/?$/.exec(url.pathname)?.[1];
      return publicId ? BMS_REQUISITIONS[publicId] : undefined;
    }
    if (url.origin === "https://bristolmyerssquibb.wd5.myworkdayjobs.com") {
      return /^\/(?:[a-z]{2}-[A-Z]{2}\/)?BMS\/job\/[^/]+\/[^/]+_(R\d+)(?:\/apply)?\/?$/.exec(url.pathname)?.[1];
    }
  }
  if (sourceId === "source-roche-china-social" && url.origin === "https://roche.wd3.myworkdayjobs.com") {
    return /^\/(?:[a-z]{2}-[A-Z]{2}\/)?roche-ext\/job\/[^/]+\/[^/]+_(\d{6}-\d+)(?:\/apply)?\/?$/.exec(url.pathname)?.[1];
  }
  if (sourceId === "source-novartis-social" && url.origin === "https://www.novartis.com.cn") {
    return /^\/careers\/career-search\/job\/details\/(req-\d+)-[^/]+\/?$/i.exec(url.pathname)?.[1]?.toUpperCase();
  }
  return undefined;
}

export function findJobClassificationEvidence(job: { sourceId?: string; officialUrl?: string }): JobClassificationEvidence | undefined {
  if (!job.sourceId || !job.officialUrl) return undefined;
  const requisitionId = nativeRequisitionId(job.sourceId, job.officialUrl);
  return VERIFIED_JOB_EVIDENCE.find((evidence) =>
    evidence.sourceId === job.sourceId && evidence.requisitionId === requisitionId
  );
}

export function resolveJobClassificationEvidence(evidence: JobClassificationEvidence): JobClassification | undefined {
  if (evidence.department) {
    return evidence.responsibilities?.category === evidence.department
      ? evidence.responsibilities
      : { category: evidence.department };
  }
  return evidence.responsibilities;
}
