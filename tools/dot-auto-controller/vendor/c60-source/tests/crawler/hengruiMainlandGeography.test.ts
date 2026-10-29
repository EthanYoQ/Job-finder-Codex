import { expect, it } from "vitest";
import { isHengruiMainlandLocation } from "../../src/crawler/hengruiMainlandGeography";

it("accepts Langzhong's mainland tuple without accepting Hong Kong or conflicting codes", () => {
  const langzhong = { country: "中国", provinceName: "四川", provinceId: 510000, cityName: "阆中市", cityId: 511381 };
  expect(isHengruiMainlandLocation(langzhong)).toBe(true);
  expect(isHengruiMainlandLocation({ ...langzhong, cityId: 511382 })).toBe(false);
  expect(isHengruiMainlandLocation({ ...langzhong, provinceId: 440000 })).toBe(false);
  expect(isHengruiMainlandLocation({ country: "中国", provinceName: "香港", provinceId: 810000, cityName: "香港", cityId: 810000 })).toBe(false);
});

for (const location of [
  { country: "中国", provinceName: "安徽", provinceId: 340000, cityName: "天长市", cityId: 341181 },
  { country: "中国", provinceName: "安徽", provinceId: 340000, cityName: "界首市", cityId: 341282 },
  { country: "中国", provinceName: "重庆市", cityName: "开州区", cityId: 500154 },
  { country: "中国", provinceName: "上海市", cityName: "浦东新区", cityId: 310115 }
]) it(`accepts exact ${location.cityName} identity and retains all original locality guards`, () => {
  expect(isHengruiMainlandLocation(location)).toBe(true);
  for (const patch of [
    { cityId: undefined }, { cityId: String(location.cityId) }, { cityId: location.cityId + 1 },
    { provinceName: "广东省" }, { provinceId: 440000 }, { country: "Germany" }, { cityName: "未登记区" }
  ]) expect(isHengruiMainlandLocation({ ...location, ...patch })).toBe(false);
  expect(isHengruiMainlandLocation({ country: "China", cityName: location.cityName })).toBe(false);
});
