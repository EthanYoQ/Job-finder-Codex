import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_livzon = {
  companyId: "company-livzon",
  sources: [
    {
      sourceId: "source-livzon-social",
      executionConfig: {
        adapterId: "official-json",
        json: OFFICIAL_API_JSON_CONFIG,
        profileBoundSource: {
          kind: "livzon-cecc",
          config: {
            socialIndexUrl: "https://www.livzon.com.cn/Social.html",
            routeDeclaredListApiUrl:
              "https://www.livzon.com.cn/fwebapi/product/product/es/findPage?appId=143150160001&templateId=product",
            listApiUrl:
              "https://www.livzon.com.cn/nportal/fwebapi/product/product/es/findPage?appId=143150160001&templateId=product",
            socialPartitionSelector:
              "#c_product_list_041-1735488276515 .p_list > .p_loopitem .e_text-5 a[href]",
            pageSize: 6,
            maxPagesPerPartition: 20,
            auditedPartitions: [
              { routePath: "/product/140/", categoryId: "1323235936422219776", categoryName: "丽珠集团总部" },
              { routePath: "/product/141/", categoryId: "1323235936447385600", categoryName: "丽珠营销总部" },
              { routePath: "/product/142/", categoryId: "1323235936472551424", categoryName: "丽珠制药厂" },
              { routePath: "/product/143/", categoryId: "1323235936501911552", categoryName: "丽珠微球" },
              { routePath: "/product/144/", categoryId: "1323235936527077376", categoryName: "丽珠单抗" },
              { routePath: "/product/145/", categoryId: "1323235936552243200", categoryName: "丽珠研究院" },
              { routePath: "/product/146/", categoryId: "1323235936577409024", categoryName: "丽珠利民" },
              { routePath: "/product/147/", categoryId: "1323235936598380544", categoryName: "丽珠合成" },
              { routePath: "/product/149/", categoryId: "1323235936648712192", categoryName: "丽珠新北江" },
              { routePath: "/product/150/", categoryId: "1323235936678072320", categoryName: "丽珠福州福兴" },
              { routePath: "/product/151/", categoryId: "1323235936707432448", categoryName: "丽珠宁夏制药" },
              { routePath: "/product/152/", categoryId: "1323235936732598272", categoryName: "上海丽珠" },
              { routePath: "/product/153/", categoryId: "1323235936757764096", categoryName: "丽珠试剂" },
              { routePath: "/product/154/", categoryId: "1323235936787124224", categoryName: "丽珠四川光大" }
            ]
          }
        }
      }
    }
  ]
} satisfies CompanyRecruitmentProfileSeed;
