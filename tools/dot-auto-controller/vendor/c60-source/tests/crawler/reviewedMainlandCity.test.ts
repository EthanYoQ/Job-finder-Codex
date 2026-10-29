import { describe, expect, it } from "vitest";
import { reviewedMainlandCity } from "../../src/crawler/reviewedMainlandCity";

describe("existing reviewed mainland city/province identities", () => {
  it.each([
    ["Leshan", "Sichuan", "乐山"], ["Tianshui", "Gansu", "天水"],
    ["Longnan", "Gansu", "陇南"], ["Liangshan Yi Autonomous Prefecture", "Sichuan", "凉山彝族自治州"],
    ["Luzhou", "Sichuan", "泸州"], ["Guang'an", "Sichuan", "广安"],
    ["Qingdao", "Shandong", "青岛"], ["Zhongshan", "Guangdong Province", "中山"],
    ["Shenyang", "Liaoning", "沈阳"], ["Beijing", "Beijing", "北京"],
    ["zhongshan", "guangdong province", "中山"]
  ])("reuses %s / %s", (city, province, expected) => {
    expect(reviewedMainlandCity(city, province)).toBe(expected);
  });
  it.each([
    ["Xinzhou", "Shaanxi"], ["Leshan", "Gansu"], ["Tianshui", "Sichuan"], ["Guang\'an", "Guangdong"], ["Qingdao", "Guangdong"], ["Zhongshan", "Shandong"], ["Unknown", "Guangdong"],
    ["Singapore", "Singapore"], ["Hong Kong", "Hong Kong"], ["Macau", "Macau"],
    ["Taipei", "Taiwan"], ["Qingdao", "Unknown"], ["CN", "China"]
  ])("does not guess %s / %s", (city, province) => {
    expect(reviewedMainlandCity(city, province)).toBeUndefined();
  });
});
