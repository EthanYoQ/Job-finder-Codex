import {expect,it} from "vitest";
import {reviewedMainlandCityLabel} from "../../src/crawler/reviewedMainlandCity";
import {parseJnjCareersChinaCards,parseJnjCareersChinaPage} from "../../src/crawler/jnjCareersChinaSourceFetch";

const card=(location:string)=>`<li class="PageList-items-item card-job" data-id="r-1"><a href="/en/jobs/r-1/role/">Shanghai role</a><div class="PagePromo-category">Quality</div><address class="PagePromo-location">${location}</address></li>`;
const page=(location:string)=>`<select name="country"><option value="China" selected>China</option></select><h2>Displaying 1 to 1 of 1 matching jobs</h2><ul>${card(location)}</ul>`;
it("reuses exact reviewed city labels after positive China scope",()=>{
  for(const [label,chinese] of [["Langfang","廊坊"],["Chongqing","重庆"],["Xuzhou","徐州"],["Wenzhou","温州"],["Shijiazhuang","石家庄"],["Shantou","汕头"],["Foshan","佛山"],["Haikou","海口"],["Wuxi","无锡"]]){
    expect(reviewedMainlandCityLabel(label!,"China")).toBe(chinese);
    expect(parseJnjCareersChinaPage(page(label!),1,20)?.jobs[0]?.cities).toEqual([chinese]);
  }
  expect(parseJnjCareersChinaCards(card("Langfang"))?.[0]?.cities).toEqual([]);
  expect(parseJnjCareersChinaPage(page("Langfang").replace(" selected", ""),1,20)).toBeUndefined();
});
it("rejects foreign, ambiguous, partial and office-only labels without title inference",()=>{
  for(const label of ["Mumbai","Hong Kong","Taipei","Taizhou","STIT","ShanghaiX","Xianyang","Unknown"]){
    expect(reviewedMainlandCityLabel(label,"China")).toBeUndefined();
    expect(parseJnjCareersChinaPage(page(label),1,20)?.jobs[0]?.cities).toEqual([]);
  }
  expect(reviewedMainlandCityLabel("Langfang","Japan")).toBeUndefined();
  expect(parseJnjCareersChinaPage(page("Shanghai / Mumbai"),1,20)?.jobs[0]?.cities).toEqual(["上海"]);
});
