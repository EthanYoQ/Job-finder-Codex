import { z } from "zod";
import { CITY_PENDING } from "./jobLocation";

export const JOB_CATEGORIES = [
  "销售",
  "市场",
  "商务",
  "渠道",
  "KA",
  "医学事务",
  "临床运营",
  "注册",
  "药物警戒/安全",
  "研发/科学",
  "生产/工程",
  "质量",
  "市场准入/政府事务",
  "数据/IT",
  "供应链/采购",
  "职能",
  "其他"
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

const JobCategorySchema = z.enum(JOB_CATEGORIES);

export const SEARCH_CITIES = ["北京", "上海", "广州"] as const;

const SearchCitySchema = z.string().trim().pipe(z.enum(SEARCH_CITIES));

export const SearchSortSchema = z.enum([
  "COMPANY_PINYIN_ASC",
  "LATEST_POSTED",
  "MATCHING_JOB_COUNT_DESC"
]);

export const SearchRequestSchema = z.object({
  city: SearchCitySchema,
  categories: z.array(JobCategorySchema).default([]),
  keyword: z.string().trim().max(120).optional(),
  companyIds: z.array(z.string().trim().min(1)).default([]),
  sort: SearchSortSchema.default("COMPANY_PINYIN_ASC"),
  newWithinDays: z.literal(7).optional()
});

/** Additive portable-only discovery option; the legacy city contract stays strict. */
export const PORTABLE_SEARCH_CITIES = [...SEARCH_CITIES, CITY_PENDING] as const;
export const PortableSearchRequestSchema = SearchRequestSchema.extend({
  city: z.string().trim().pipe(z.enum(PORTABLE_SEARCH_CITIES))
});

export const COMPANY_EXPANSION_PAGE_SIZE = 10;
export const COMPANY_EXPANSION_MAX_RETURNED = 50;

export const CompanyExpansionRequestSchema = z
  .object({
    companyId: z.string().trim().min(1),
    offset: z.number().int().min(0).default(0),
    limit: z
      .number()
      .int()
      .min(1)
      .max(COMPANY_EXPANSION_PAGE_SIZE)
      .default(COMPANY_EXPANSION_PAGE_SIZE)
  })
  .refine((value) => value.offset + value.limit <= COMPANY_EXPANSION_MAX_RETURNED, {
    message: "Company expansion exceeds the controlled loading cap"
  });
