/** Synthetic contract rows only: no retained API capture, job descriptions, or live job data. */
export type SyntheticBiRow = Record<string, string>;

const LOCATIONS = [
  ["北京", "Beijing"], ["上海", "Shanghai"], ["信阳", "Xinyang"],
  ["南昌", "Nanchang"], ["成都", "Chengdu"], ["杭州", "Hangzhou"],
  ["武汉", "Wuhan"], ["泰州", "Taizhou"], ["秦皇岛", "Qinhuangdao"],
  ["银川", "Yinchuan"], ["长沙", "Changsha"], ["驻马店", "Zhumadian"]
] as const;

export function syntheticBiJsonp(): string {
  const joblist: SyntheticBiRow[] = Array.from({ length: 44 }, (_, index) => {
    const [location, englishLocation] = LOCATIONS[index % LOCATIONS.length]!;
    return {
      address: "", coid: "88000001", coname: "Synthetic BI subsidiary", ctmid: "3479",
      degreefrom: "", divid: "", divname: "", edegreefrom: "", efuntype: "",
      ejobareaname: englishLocation, eworkareaname: englishLocation, eworkyearname: "",
      funtype: "", issuedate: "2026-10-01", jkeyword: "", jobareaname: location,
      jobid: String(99000001 + index), jobname: `Synthetic BI role ${index + 1}`,
      jobnum: "1", joborder: String(index + 1), monthlysalary: "", poscode: "",
      providesalarname: "", term: "", workareaname: location, workyearname: ""
    };
  });
  return `jsoncallback(${JSON.stringify({
    status: "1", message: "接口调用成功", resultbody: { totalnum: String(joblist.length), joblist }
  })})`;
}
