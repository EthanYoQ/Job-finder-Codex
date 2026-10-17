import { expect, it } from "vitest";
import { isHengruiMainlandLocation } from "../../src/crawler/hengruiMainlandGeography";

it("accepts Langzhong's mainland tuple without accepting Hong Kong or conflicting codes", () => {
  const langzhong = { country: "中国", provinceName: "四川", provinceId: 510000, cityName: "阆中市", cityId: 511381 };
  expect(isHengruiMainlandLocation(langzhong)).toBe(true);
  expect(isHengruiMainlandLocation({ ...langzhong, cityId: 511382 })).toBe(false);
  expect(isHengruiMainlandLocation({ ...langzhong, provinceId: 440000 })).toBe(false);
  expect(isHengruiMainlandLocation({ country: "中国", provinceName: "香港", provinceId: 810000, cityName: "香港", cityId: 810000 })).toBe(false);
});
