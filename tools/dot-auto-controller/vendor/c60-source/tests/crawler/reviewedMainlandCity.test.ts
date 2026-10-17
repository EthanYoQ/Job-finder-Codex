import { describe, expect, it } from "vitest";
import { reviewedMainlandCity } from "../../src/crawler/reviewedMainlandCity";

describe("existing reviewed mainland city/province identities", () => {
  it.each([
    ["Qingdao", "Shandong", "青岛"], ["Zhongshan", "Guangdong Province", "中山"],
    ["Shenyang", "Liaoning", "沈阳"], ["Beijing", "Beijing", "北京"],
    ["zhongshan", "guangdong province", "中山"]
  ])("reuses %s / %s", (city, province, expected) => {
    expect(reviewedMainlandCity(city, province)).toBe(expected);
  });
  it.each([
    ["Qingdao", "Guangdong"], ["Zhongshan", "Shandong"], ["Unknown", "Guangdong"],
    ["Singapore", "Singapore"], ["Hong Kong", "Hong Kong"], ["Macau", "Macau"],
    ["Taipei", "Taiwan"], ["Qingdao", "Unknown"], ["CN", "China"]
  ])("does not guess %s / %s", (city, province) => {
    expect(reviewedMainlandCity(city, province)).toBeUndefined();
  });
});
