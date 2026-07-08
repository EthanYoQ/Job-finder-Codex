import { describe, expect, it } from "vitest";
import {
  candidateCompanies,
  getCandidatePoolStats,
  getSocialSources
} from "../../src/data/companyRegistry";

const THIRD_PARTY_ATS_HOSTS = new Set(["app.mokahr.com", "fosunpharma.zhiye.com"]);

function collectCandidateUrls(candidate: (typeof candidateCompanies)[number]): string[] {
  const companyUrls = [candidate.officialWebsiteUrl];
  const sourceUrls = candidate.sources.flatMap((source) => [
    source.officialEntryUrl,
    source.officialChainEvidenceUrl,
    source.campusEntryUrl
  ]);

  return [...companyUrls, ...sourceUrls].filter((url): url is string => Boolean(url));
}

describe("P0 company registry", () => {
  it("keeps the P0 candidate pool inside the required 80-120 range", () => {
    const stats = getCandidatePoolStats(candidateCompanies);

    expect(stats.totalCandidates).toBeGreaterThanOrEqual(80);
    expect(stats.totalCandidates).toBeLessThanOrEqual(120);
  });

  it("marks the registry as P0-launchable once 50 companies are configured verified scrapable", () => {
    const stats = getCandidatePoolStats(candidateCompanies);

    expect(stats.verifiedScrapableCompanies).toBeGreaterThanOrEqual(50);
    expect(stats.canLaunchP0).toBe(true);
  });

  it("separates social sources from campus sources", () => {
    const socialSources = getSocialSources(candidateCompanies);

    expect(socialSources.length).toBeGreaterThan(0);
    expect(socialSources.every((source) => source.kind === "SOCIAL")).toBe(true);
  });

  it("does not use placeholder .invalid URLs for candidate provenance", () => {
    const urls = candidateCompanies.flatMap(collectCandidateUrls);

    expect(urls.some((url) => url.includes(".invalid"))).toBe(false);
  });

  it("requires first-party official-chain provenance for verified scrapable social sources", () => {
    const companiesById = new Map(candidateCompanies.map((company) => [company.id, company]));
    const verifiedSocialSources = getSocialSources(candidateCompanies).filter(
      (source) => source.status === "VERIFIED_SCRAPABLE"
    );

    expect(verifiedSocialSources.length).toBeGreaterThan(0);

    for (const source of verifiedSocialSources) {
      const company = companiesById.get(source.companyId);

      expect(company?.officialWebsiteUrl).toEqual(expect.any(String));
      expect(source.officialEntryUrl).toEqual(expect.any(String));
      expect(source.officialChainEvidenceUrl).toEqual(expect.any(String));

      const officialWebsiteHost = new URL(company!.officialWebsiteUrl!).host;
      const chainEvidenceHost = new URL(source.officialChainEvidenceUrl!).host;

      expect(THIRD_PARTY_ATS_HOSTS.has(officialWebsiteHost)).toBe(false);
      expect(THIRD_PARTY_ATS_HOSTS.has(chainEvidenceHost)).toBe(false);
    }
  });

  it("omits official-source URLs for unverified candidates without known provenance", () => {
    const candidate = candidateCompanies.find(
      (company) => company.id === "company-sino-biopharmaceutical"
    );
    const socialSource = candidate?.sources.find((source) => source.kind === "SOCIAL");

    expect(candidate?.officialWebsiteUrl).toBeUndefined();
    expect(socialSource?.officialEntryUrl).toBeUndefined();
    expect(socialSource?.officialChainEvidenceUrl).toBeUndefined();
  });

  it("records official-chain evidence for wave 1 added sources", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-hengrui")?.sources[0]).toMatchObject({
      status: "VERIFIED_SCRAPABLE",
      atsKind: "MOKA",
      officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
      officialChainEvidenceUrl: "https://www.hengrui.com/development/recruit.html"
    });

    expect(byId.get("company-kelun")?.sources[0]).toMatchObject({
      status: "VERIFIED_SCRAPABLE",
      atsKind: "BEISEN_ZHIYE",
      officialEntryUrl: "https://kelun.zhiye.com/social",
      officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html"
    });

    expect(byId.get("company-cspc")?.sources[0]).toMatchObject({
      status: "ENTRY_FOUND_PENDING_ADAPTER",
      atsKind: "REDSEA",
      officialEntryUrl: "https://www.e-cspc.com/hr/",
      officialChainEvidenceUrl: "https://www.e-cspc.com/hr/"
    });
  });

  it("records official-chain evidence for the task 4 verified source batch", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-beta-pharma")).toMatchObject({
      officialWebsiteUrl: "https://www.bettapharma.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "BEISEN_ZHIYE",
          officialEntryUrl: "https://bettapharma.zhiye.com/Social",
          officialChainEvidenceUrl: "https://www.bettapharma.com/Jobs/"
        })
      ]
    });

    expect(byId.get("company-allist")).toMatchObject({
      officialWebsiteUrl: "https://www.allist.com.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "BEISEN_ZHIYE",
          officialEntryUrl: "https://allist.zhiye.com/Social",
          officialChainEvidenceUrl: "https://www.allist.com.cn/recruit.html"
        })
      ]
    });

    expect(byId.get("company-hansoh")).toMatchObject({
      officialWebsiteUrl: "https://cn.hspharm.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "BEISEN_ZHIYE",
          officialEntryUrl: "https://hspharm.zhiye.com/Social",
          officialChainEvidenceUrl: "https://cn.hspharm.com/site/solr.htm"
        })
      ]
    });

    expect(byId.get("company-kelun-biotech")).toMatchObject({
      officialWebsiteUrl: "https://www.kelun-biotech.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "BEISEN_ZHIYE",
          officialEntryUrl: "https://kelunbotai.zhiye.com/Social",
          officialChainEvidenceUrl: "https://www.kelun-biotech.com/RecruitTalented.aspx"
        })
      ]
    });

    expect(byId.get("company-kpc")).toMatchObject({
      officialWebsiteUrl: "https://www.kpc.com.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.kpc.com.cn/job/she-hui-zhao-pin-list-0.htm",
          officialChainEvidenceUrl: "https://www.kpc.com.cn/job/index.htm"
        })
      ]
    });

    expect(byId.get("company-mabwell")).toMatchObject({
      officialWebsiteUrl: "https://www.mabwell.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.mabwell.com/jobs.html",
          officialChainEvidenceUrl: "https://www.mabwell.com/careers.html"
        })
      ]
    });

    expect(byId.get("company-akeso")).toMatchObject({
      officialWebsiteUrl: "https://www.akesobio.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.akesobio.com/cn/career/social-recruitment/",
          officialChainEvidenceUrl: "https://www.akesobio.com/cn/career/"
        })
      ]
    });

    expect(byId.get("company-sanofi-china")).toMatchObject({
      officialWebsiteUrl: "https://www.sanofi.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://jobs.sanofi.com/en/china",
          officialChainEvidenceUrl: "https://jobs.sanofi.com/en/china"
        })
      ]
    });

    expect(byId.get("company-cstone")).toMatchObject({
      officialWebsiteUrl: "https://www.cstonepharma.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.cstonepharma.com/join/job.html",
          officialChainEvidenceUrl: "https://www.cstonepharma.com/join/job.html"
        })
      ]
    });

    expect(byId.get("company-rcbio")).toMatchObject({
      officialWebsiteUrl: "https://www.remegen.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "MOKA",
          officialEntryUrl: "https://app.mokahr.com/social-recruitment/remegen/45549#/jobs",
          officialChainEvidenceUrl: "https://www.remegen.com/index.php?cid=45&v=listing"
        })
      ]
    });
  });

  it("records official-chain evidence for the bulk task 6 static official html wave", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-grand-pharma-china")).toMatchObject({
      officialWebsiteUrl: "https://www.grandpharma.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://job.grandpharma.cn/",
          officialChainEvidenceUrl: "https://job.grandpharma.cn/"
        })
      ]
    });

    expect(byId.get("company-joincare")).toMatchObject({
      officialWebsiteUrl: "https://www.joincare.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.joincare.com/Social_recruitment.html",
          officialChainEvidenceUrl: "https://www.joincare.com/Social_recruitment.html"
        })
      ]
    });

    expect(byId.get("company-puluo")).toMatchObject({
      officialWebsiteUrl: "https://www.apeloa.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.apeloa.com/join.html",
          officialChainEvidenceUrl: "https://www.apeloa.com/join.html"
        })
      ]
    });

    expect(byId.get("company-hisun")).toMatchObject({
      officialWebsiteUrl: "https://www.hisunpharm.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.hisunpharm.com/main/recruit-list.thtml?cId=10982",
          officialChainEvidenceUrl: "https://www.hisunpharm.com/main/recruit.thtml?cId=10981"
        })
      ]
    });

    expect(byId.get("company-huahai")).toMatchObject({
      officialWebsiteUrl: "https://www.huahaipharm.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.huahaipharm.com/zpgw.html",
          officialChainEvidenceUrl: "https://www.huahaipharm.com/zpgw.html"
        })
      ]
    });

    expect(byId.get("company-alphamab")).toMatchObject({
      officialWebsiteUrl: "https://www.alphamabonc.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.alphamabonc.com/career/job.html",
          officialChainEvidenceUrl: "https://www.alphamabonc.com/career/job.html"
        })
      ]
    });

    expect(byId.get("company-ascentage")).toMatchObject({
      officialWebsiteUrl: "https://ascentage.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://ascentage.com/careers/job-opportunities/",
          officialChainEvidenceUrl: "https://ascentage.com/careers/job-opportunities/"
        })
      ]
    });

    expect(byId.get("company-nhwa")).toMatchObject({
      officialWebsiteUrl: "https://www.nhwa-group.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://www.nhwa-group.com/job/ren-cai-zhao-pin-list-0.htm",
          officialChainEvidenceUrl: "https://www.nhwa-group.com/job/ren-cai-zhao-pin-list-0.htm"
        })
      ]
    });
  });

  it("records official-chain evidence for the Workday source wave", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-pfizer-china")).toMatchObject({
      officialWebsiteUrl: "https://www.pfizer.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
          officialChainEvidenceUrl: "https://www.pfizer.com/about/careers"
        })
      ]
    });

    expect(byId.get("company-haleon-china")).toMatchObject({
      officialWebsiteUrl: "https://www.haleon.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://gsknch.wd3.myworkdayjobs.com/GSKCareers",
          officialChainEvidenceUrl: "https://www.haleon.com/careers"
        })
      ]
    });

    expect(byId.get("company-roche-china")).toMatchObject({
      officialWebsiteUrl: "https://www.roche.com.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext",
          officialChainEvidenceUrl: "https://careers.roche.com/cn/zh/china-mainland"
        })
      ]
    });

    expect(byId.get("company-msd-china")).toMatchObject({
      officialWebsiteUrl: "https://www.msdchina.com.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://msd.wd5.myworkdayjobs.com/SearchJobs",
          officialChainEvidenceUrl: "https://jobs.msd.com/cn/zh"
        })
      ]
    });

    expect(byId.get("company-bms-china")).toMatchObject({
      officialWebsiteUrl: "https://www.bms.com/cn",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://bristolmyerssquibb.wd5.myworkdayjobs.com/BMS",
          officialChainEvidenceUrl: "https://careers.bms.com/cn/"
        })
      ]
    });

    expect(byId.get("company-gilead-china")).toMatchObject({
      officialWebsiteUrl: "https://www.gileadchina.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://gilead.wd1.myworkdayjobs.com/gileadcareers",
          officialChainEvidenceUrl: "https://www.gilead.com/careers/opportunities"
        })
      ]
    });

    expect(byId.get("company-agilent-china")).toMatchObject({
      officialWebsiteUrl: "https://www.agilent.com.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://agilent.wd5.myworkdayjobs.com/Agilent_Careers",
          officialChainEvidenceUrl: "https://careers.agilent.com/locations/asia-pacific/china/"
        })
      ]
    });

    expect(byId.get("company-abbott-china")).toMatchObject({
      officialWebsiteUrl: "https://www.abbott.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://abbott.wd5.myworkdayjobs.com/abbottcareers",
          officialChainEvidenceUrl: "https://www.abbott.com/careers.html"
        })
      ]
    });

    expect(byId.get("company-stryker-china")).toMatchObject({
      officialWebsiteUrl: "https://www.stryker.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://stryker.wd1.myworkdayjobs.com/StrykerCareers",
          officialChainEvidenceUrl: "https://careers.stryker.com/"
        })
      ]
    });

    expect(byId.get("company-gehc-china")).toMatchObject({
      officialWebsiteUrl: "https://www.gehealthcare.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://gehc.wd5.myworkdayjobs.com/gehc_externalsite",
          officialChainEvidenceUrl: "https://www.gehealthcare.com/about/careers"
        })
      ]
    });

    expect(byId.get("company-edwards-china")).toMatchObject({
      officialWebsiteUrl: "https://www.edwards.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://edwards.wd5.myworkdayjobs.com/edwardscareers",
          officialChainEvidenceUrl: "https://www.edwards.com/careers/jobsearch"
        })
      ]
    });

    expect(byId.get("company-medtronic-china")).toMatchObject({
      officialWebsiteUrl: "https://www.medtronic.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers",
          officialChainEvidenceUrl: "https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers"
        })
      ]
    });
  });

  it("records official-chain evidence for the Hotjob Wecruit source wave", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-simcere")).toMatchObject({
      officialWebsiteUrl: "https://www.simcere.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "HOTJOB_WECRUIT",
          officialEntryUrl: "https://wecruit.hotjob.cn/SU61458d83bef57c54dcb4e43f/pb/index.html",
          officialChainEvidenceUrl: "https://www.simcere.com/jrwm/jrwm.aspx"
        })
      ]
    });

    expect(byId.get("company-haisco")).toMatchObject({
      officialWebsiteUrl: "https://www.haisco.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "HOTJOB_WECRUIT",
          officialEntryUrl: "https://wecruit.hotjob.cn/SU6663b85a1eb8051cd22556e3/pb/social.html",
          officialChainEvidenceUrl: "https://www.haisco.com/recruitment.html"
        })
      ]
    });

    expect(byId.get("company-cr-sanjiu")).toMatchObject({
      officialWebsiteUrl: "https://www.999.com.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "HOTJOB_WECRUIT",
          officialEntryUrl: "https://wecruit.hotjob.cn/SU613834ecbef57c3b6383b50e/pb/index.html",
          officialChainEvidenceUrl: "https://www.999.com.cn/applicationGuide/index.html"
        })
      ]
    });
  });

  it("records official-chain evidence for the final P0 source wave", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-innovent")).toMatchObject({
      officialWebsiteUrl: "https://www.innoventbio.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_JSON",
          officialEntryUrl: "https://www.innoventbio.com/cn/recruit",
          officialChainEvidenceUrl: "https://www.innoventbio.com/cn/recruit"
        })
      ]
    });

    expect(byId.get("company-novo-nordisk-china")).toMatchObject({
      officialWebsiteUrl: "https://www.novonordisk.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_JSON",
          officialEntryUrl:
            "https://www.novonordisk.com/careers/find-a-job/career-search-results.html",
          officialChainEvidenceUrl: "https://www.novonordisk.com/careers/find-a-job.html"
        })
      ]
    });

    expect(byId.get("company-boehringer-ingelheim-china")).toMatchObject({
      officialWebsiteUrl: "https://www.boehringer-ingelheim.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "SUCCESSFACTORS",
          officialEntryUrl: "https://jobs.boehringer-ingelheim.com/search/?q=&locationsearch=China",
          officialChainEvidenceUrl: "https://jobs.boehringer-ingelheim.com/"
        })
      ]
    });

    expect(byId.get("company-merck-china")).toMatchObject({
      officialWebsiteUrl: "https://www.merckgroup.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_JSON",
          officialEntryUrl: "https://careers.emdgroup.com/us/en/search-results?keywords=China",
          officialChainEvidenceUrl: "https://careers.emdgroup.com/us/en/"
        })
      ]
    });

    expect(byId.get("company-sinocelltech")).toMatchObject({
      officialWebsiteUrl: "https://www.sinocelltech.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "HOTJOB_WECRUIT",
          officialEntryUrl: "https://www.hotjob.cn/wt/SCT/web/index",
          officialChainEvidenceUrl: "https://www.sinocelltech.com/Gather/job/pid/7.html"
        })
      ]
    });

    expect(byId.get("company-thermo-fisher-china")).toMatchObject({
      officialWebsiteUrl: "https://www.thermofisher.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_JSON",
          officialEntryUrl: "https://jobs.thermofisher.com/global/en/china-jobs",
          officialChainEvidenceUrl: "https://jobs.thermofisher.com/global/en"
        })
      ]
    });
  });

  it("records official-chain evidence for the global static HTML source wave", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-bayer-healthcare")).toMatchObject({
      officialWebsiteUrl: "https://www.bayer.com.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "SUCCESSFACTORS",
          officialEntryUrl: "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN",
          officialChainEvidenceUrl: "https://www.bayer.com.cn/zh-hans/zhaoxiannashi"
        })
      ]
    });

    expect(byId.get("company-takeda-china")).toMatchObject({
      officialWebsiteUrl: "https://www.takeda.com.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://jobs.takeda.com/location/china-jobs/1113/1814991/2",
          officialChainEvidenceUrl: "https://www.takeda.com/careers/"
        })
      ]
    });
  });

  it("records official-chain evidence for the Kenvue and Zai Lab source wave", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-kenvue-china")).toMatchObject({
      officialWebsiteUrl: "https://www.kenvue.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://kenvue.wd5.myworkdayjobs.com/kenvue",
          officialChainEvidenceUrl: "https://www.kenvue.com/careers"
        })
      ]
    });

    expect(byId.get("company-zaiding")).toMatchObject({
      officialWebsiteUrl: "https://cn.zailaboratory.com/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "OFFICIAL_HTML",
          officialEntryUrl: "https://cn.zailaboratory.com/jobs/",
          officialChainEvidenceUrl: "https://cn.zailaboratory.com/careers/"
        })
      ]
    });
  });

  it("records official-chain evidence for the Amgen Workday source", () => {
    const byId = new Map(candidateCompanies.map((company) => [company.id, company]));

    expect(byId.get("company-amgen-china")).toMatchObject({
      officialWebsiteUrl: "https://www.amgen.cn/",
      sources: [
        expect.objectContaining({
          status: "VERIFIED_SCRAPABLE",
          atsKind: "WORKDAY",
          officialEntryUrl: "https://amgen.wd1.myworkdayjobs.com/Careers",
          officialChainEvidenceUrl: "https://www.amgen.com/careers"
        })
      ]
    });
  });
});
