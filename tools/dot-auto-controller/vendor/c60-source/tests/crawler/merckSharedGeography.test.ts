import { expect, it } from "vitest";
import { merckOfficialCities } from "../../src/crawler/merckChinaQuality";

it("reuses mainland city evidence and retains municipality-only evidence without guessing a job city", () => {
 const row = {"country":"China","city":"Shanghai","state":"Shanghai","location":"Shanghai, Shanghai, China","cityState":"Shanghai, Shanghai","cityStateCountry":"Shanghai, Shanghai, China","latitude":"31.22222","longitude":"121.45806","multi_location":["Shanghai, Shanghai, China"],"isMultiLocation":false,"multi_location_array":[{"latlong":{"lon":121.45806,"lat":31.22222},"location":"Shanghai, Shanghai, China"}],"title":"零售电商助理产品经理"};
 for (const title of ["医药代表-肿瘤-贵阳", "客户经理-Rare Tumor-昆明", "客户经理-Rare Tumor-苏州/无锡"]) expect(merckOfficialCities({...row,title})).toEqual(["城市待核"]);
 for (const title of ["高级技术应用专家-下游工艺", "电商运营经理-零售"]) expect(merckOfficialCities({...row,title})).toEqual(["上海"]);
 expect(merckOfficialCities({"country":"China","city":"","state":"Shanghai","location":"Shanghai, China","cityState":"Shanghai","cityStateCountry":"Shanghai, China","latitude":"31.22222","longitude":"121.45806","multi_location":["Shanghai, China"],"isMultiLocation":false,"multi_location_array":[{"latlong":{"lon":121.45806,"lat":31.22222},"location":"Shanghai, China"}],"title":"客户经理-Rare Tumor-杭州"})).toEqual(["城市待核"]);
 for (const mutation of [{country:"United States"},{city:"Boston"},{title:"Regional Manager - Boston"},{title:"区域经理-未审核城市"}]) expect(merckOfficialCities({...row,...mutation})).toBeUndefined();
});
