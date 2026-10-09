import { describe, expect, it } from "vitest";
import { JOB_CATEGORIES } from "../../src/domain/search";
import {
  fromPrismaJobCategory,
  fromPrismaLifecycleStatus,
  toPrismaJobCategory,
  toPrismaLifecycleStatus,
  toPrismaRequiredJobField
} from "../../src/db/prismaMappers";

describe("Prisma enum mappers", () => {
  it("maps every domain job category to the Prisma enum name", () => {
    const mapped = JOB_CATEGORIES.map((category) => toPrismaJobCategory(category));

    expect(mapped).toEqual([
      "SALES",
      "MARKETING",
      "BUSINESS",
      "CHANNEL",
      "KA",
      "MEDICAL_AFFAIRS",
      "CLINICAL_OPERATIONS",
      "REGULATORY",
      "DRUG_SAFETY",
      "RESEARCH_SCIENCE",
      "MANUFACTURING_ENGINEERING",
      "QUALITY",
      "MARKET_ACCESS_GOVERNMENT",
      "DATA_IT",
      "SUPPLY_CHAIN_PROCUREMENT",
      "CORPORATE_FUNCTIONS",
      "OTHER"
    ]);
  });

  it("maps crawler required fields to the Prisma enum names", () => {
    const requiredFields = ["company", "title", "officialUrl", "location"] as const;

    expect(requiredFields.map(toPrismaRequiredJobField)).toEqual([
      "COMPANY",
      "TITLE",
      "OFFICIAL_URL",
      "LOCATION"
    ]);
  });

  it("maps lifecycle status strings to Prisma enum names", () => {
    const lifecycleStatuses = ["ACTIVE", "SUSPECTED_OFFLINE", "OFFLINE"] as const;

    expect(lifecycleStatuses.map(toPrismaLifecycleStatus)).toEqual([
      "ACTIVE",
      "SUSPECTED_OFFLINE",
      "OFFLINE"
    ]);
  });

  it("maps Prisma job category names back to domain Chinese labels", () => {
    expect(fromPrismaJobCategory("SALES")).toBe("销售");
    expect(fromPrismaJobCategory("MARKET_ACCESS_GOVERNMENT")).toBe("市场准入/政府事务");
    expect(fromPrismaJobCategory("CORPORATE_FUNCTIONS")).toBe("职能");
  });

  it("maps Prisma lifecycle status names back to crawler lifecycle strings", () => {
    expect(fromPrismaLifecycleStatus("ACTIVE")).toBe("ACTIVE");
    expect(fromPrismaLifecycleStatus("SUSPECTED_OFFLINE")).toBe("SUSPECTED_OFFLINE");
    expect(fromPrismaLifecycleStatus("OFFLINE")).toBe("OFFLINE");
  });
});
