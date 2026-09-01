export const HUMAN_VERIFIED_RECRUITMENT_BASELINE = {
  schemaVersion: "human-recruitment-baseline-v1",
  observedOn: "2026-09-02",
  provenance: {
    workbookName: "医药公司招聘网址与职位数量_2026-08-25-人工核实.xlsx",
    workbookSha256: "a325c6009b5f3bfd2308c0a38fcdd783d81b8fcf8c9072ea1c07357b0f31715d",
    authority: "USER_SUPPLIED_MANUAL_VERIFICATION"
  },
  companies: [
    ["company-johnson-innovative-medicine", 100, "https://www.careers.jnj.com/en/"],
    ["company-abbvie-china", 57, "https://www.abbvie.com.cn/join-us.html"],
    ["company-msd-china", 105, "https://www.ajinga.com/msdchina/professionals"],
    ["company-roche-china", 236, "https://careers.roche.com/cn/zh/search-results"],
    ["company-pfizer-china", 226, "https://www.pfizer.com.cn/zh-hans/careers-cn"],
    ["company-astrazeneca", 224, "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c"],
    ["company-novartis", 140, "https://www.novartis.com.cn/careers/career-search?search_api_fulltext=&country%5B%5D=LOC_CN&op=Submit&field_job_posted_date=All"],
    ["company-bms-china", 23, "https://jobs.bms.com/careers?start=0&location=china&pid=137482898922&sort_by=distance&filter_include_remote=1&filter_include_relocation=0"],
    ["company-sanofi-china", 115, "https://jobs.sanofi.cn/%e6%b1%82%e8%81%8c/%E4%B8%AD%E5%9B%BD/2649/2/1814991/35/105/50/2"],
    ["company-novo-nordisk-china", 95, "https://www.novonordisk.com.cn/careers/find-a-job/career-search-results.html?searchText=&countries=China&categories="],
    ["company-lilly-china", 37, null, "Official recruitment redirect was unstable during manual verification."],
    ["company-gsk-china", 0, "https://www.gsk-china.com/zh-cn/careers/", "No mainland location option was visible."],
    ["company-amgen-china", 38, "https://careers.amgen.com/en/search-jobs/China/87/2/1814991/35/105/50/2"],
    ["company-takeda-china", 119, "https://jobs.takeda.com/search-jobs/%E4%B8%AD%E5%9B%BD/1113/2/1814991/35/105/50/2"],
    ["company-gilead-china", 15, "https://gilead.yello.co/job_boards/v42vD4vKxb3AkKvV93YsrQ"],
    ["company-boehringer-ingelheim-china", 36, "https://campus.51job.com/BI/recruitSociety.html"],
    ["company-bayer-healthcare", 0, "https://www.bayer.com.cn/zh-hans/zhaoxiannashi", "The official web page exposed no jobs; a separate WeChat mini program was out of crawler scope."],
    ["company-csl-china", 177, "https://csl.wd1.myworkdayjobs.com/zh-CN/CSL_External", "Conflict found after verification: 177 is the unfiltered global total; the same official response exposes a separate China facet. Preserve the workbook observation, but never use 177 as China-scope runtime truth."],
    ["company-viatris", 252, "https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT"],
    ["company-teva-china", 0, "https://www.careers.teva/careers?location=China"],
    ["company-astellas-china", 15, "https://www.astellas.com/en/careers/china-recruitment#"],
    ["company-daiichi-sankyo-china", 94, "https://daiichisankyo.cnstaff.com/recruit"],
    ["company-sandoz-china", 0, "https://www.aspenpharma.cn/careers-at-aspen/aspen-cnjobs/", "Company identity is Aspen, formerly the Sandoz China business."],
    ["company-merck-china", 52, "https://careers.merckgroup.com/cn/zh/search-results?keywords=China"],
    ["company-otsuka-china", 0, "https://www.chinaotsuka.com.cn/class/26", "The Otsuka group jobs used previously were not pharmaceutical jobs."],
    ["company-biogen-china", 6, "https://biibhr.wd3.myworkdayjobs.com/external?locationCountry=6cb77610a8a543aea2d6bc10457e35d4"],
    ["company-grifols-china", 2, "https://jobsearch.grifols.com/search?createNewAlert=false&q=&locationsearch=China"],
    ["company-organon-china", 30, "https://jobs.organon.com/cn/zh/search-results?keywords=China"],
    ["company-ucb-china", 3, "https://careers.ucb.com/global/zh/search-results?keywords=China"],
    ["company-servier-china", 50, "https://www.servier.com.cn/careers#/jobs"],
    ["company-cr-pharma", null, null, "No unique public filter could be verified; keep the result UNKNOWN."],
    ["company-qilu", 1, "https://www.qilu-pharma.com/JobPosting_list.html"],
    ["company-grand-pharma", 3, "https://job.grandpharma.cn/"],
    ["company-fosun-pharma", 90, "https://fosunpharma.zhiye.com/social"],
    ["company-cspc", 9, "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/0beb3022-3214-4333-a2e7-20786c4916d5/officeWebsite.mob", "Social recruitment only."],
    ["company-hengrui", 993, "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs"],
    ["company-cttq", 641, "https://cttq.zhiye.com/social/jobs"],
    ["company-shanghai-pharma", 95, "https://sph.zhiye.com/social/jobs"],
    ["company-kelun", 29, "https://kelun.zhiye.com/social?r=&p=1^2&c=&d=&k=#jlt", "Marketing category selected."],
    ["company-united-lab", 14, "https://tulchina.zhiye.com/social/jobs", "Social jobs changed within the preceding six months only."],
    ["company-hansoh", 264, "https://hspharm.zhiye.com/social/jobs", "Social jobs changed within the preceding six months; one multi-location posting counts once."]
  ]
} as const;

export type HumanVerifiedRecruitmentCompany =
  (typeof HUMAN_VERIFIED_RECRUITMENT_BASELINE.companies)[number];

export function humanVerifiedCompanyIds(): string[] {
  return HUMAN_VERIFIED_RECRUITMENT_BASELINE.companies.map(([companyId]) => companyId);
}
