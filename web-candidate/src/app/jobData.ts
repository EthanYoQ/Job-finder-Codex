import type { JobSubcategory } from "../domain/jobClassification";
import type { JobCategory } from "../domain/search";

export interface JobResult {
  id: string;
  title: string;
  officialTitle?: string;
  officialPublishedAt: string;
  city: string;
  category: JobCategory;
  subcategory?: JobSubcategory;
  isNew: boolean;
  officialUrl: string;
}

export interface CompanyResult {
  id: string;
  companyName: string;
  pinyin: string;
  jobs: JobResult[];
}

export const companies: CompanyResult[] = [
  {
    id: "astrazeneca",
    companyName: "阿斯利康",
    pinyin: "a si li kang",
    jobs: [
      {
        id: "az-sales-beijing",
        title: "区域销售经理（北京）",
        officialTitle: "Regional Sales Manager (Beijing)",
        officialPublishedAt: "2026-07-04T09:00:00.000Z",
        city: "北京",
        category: "销售",
        isNew: true,
        officialUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c"
      }
    ]
  },
  {
    id: "beigene",
    companyName: "百济神州",
    pinyin: "bai ji shen zhou",
    jobs: [
      {
        id: "beigene-clinical",
        title: "临床研究监察员（CRA）",
        officialTitle: "Clinical Research Associate (CRA)",
        officialPublishedAt: "2026-07-04T08:00:00.000Z",
        city: "北京",
        category: "临床运营",
        isNew: true,
        officialUrl: "https://app.mokahr.com/social-recruitment/BeiGene"
      }
    ]
  },
  {
    id: "pfizer",
    companyName: "辉瑞",
    pinyin: "hui rui",
    jobs: [
      {
        id: "pfizer-medical-info",
        title: "医学信息沟通专员（呼吸领域）",
        officialTitle: "Medical Information Associate (Respiratory)",
        officialPublishedAt: "2026-07-03T09:00:00.000Z",
        city: "北京",
        category: "销售",
        isNew: true,
        officialUrl: "https://www.pfizer.com.cn/careers"
      },
      {
        id: "pfizer-msl",
        title: "MSL 医学科学联络官",
        officialTitle: "Medical Science Liaison (Oncology)",
        officialPublishedAt: "2026-07-05T10:00:00.000Z",
        city: "北京",
        category: "医学事务",
        isNew: false,
        officialUrl: "https://www.pfizer.com.cn/careers"
      },
      {
        id: "pfizer-market-access",
        title: "市场准入专员",
        officialTitle: "Market Access Specialist",
        officialPublishedAt: "2026-06-28T08:00:00.000Z",
        city: "北京",
        category: "市场准入/政府事务",
        isNew: false,
        officialUrl: "https://www.pfizer.com.cn/careers"
      }
    ]
  },
  {
    id: "novartis",
    companyName: "诺华",
    pinyin: "nuo hua",
    jobs: [
      {
        id: "novartis-product",
        title: "肿瘤产品医药代表",
        officialTitle: "Oncology Product Representative",
        officialPublishedAt: "2026-07-06T12:00:00.000Z",
        city: "北京",
        category: "销售",
        isNew: false,
        officialUrl: "https://www.novartis.com.cn/careers/career-search/tag/LOC_CN?page=0"
      }
    ]
  },
  {
    id: "innovent",
    companyName: "信达生物",
    pinyin: "xin da sheng wu",
    jobs: [
      {
        id: "innovent-sales",
        title: "高级医学信息沟通经理",
        officialTitle: "Senior Medical Information Manager",
        officialPublishedAt: "2026-07-01T09:30:00.000Z",
        city: "北京",
        category: "销售",
        isNew: false,
        officialUrl: "https://cn.innoventbio.com/"
      }
    ]
  }
];
