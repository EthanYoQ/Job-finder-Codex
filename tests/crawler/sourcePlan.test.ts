import { describe, expect, it } from "vitest";
import { candidateCompanies, type CandidateCompany } from "../../src/data/companyRegistry";
import { buildSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";

describe("source crawl planning", () => {
  it("creates crawl plans only for social sources with official entry and chain evidence", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);

    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((plan) => plan.source.kind === "SOCIAL")).toBe(true);
    expect(plans.every((plan) => plan.source.status === "VERIFIED_SCRAPABLE")).toBe(true);
    expect(plans.every((plan) => plan.source.officialEntryUrl)).toBe(true);
    expect(plans.every((plan) => plan.source.officialChainEvidenceUrl)).toBe(true);
    expect(plans.some((plan) => plan.company.id === "company-hengrui")).toBe(true);
    expect(plans.some((plan) => plan.company.id === "company-cspc")).toBe(false);
  });

  it("does not plan pending sources even when they have official urls and adapter config", () => {
    const pendingConfiguredCompany: CandidateCompany = {
      id: "company-astrazeneca",
      officialChineseName: "阿斯利康制药有限公司",
      pinyinName: "asili-kang",
      inclusionReason: "local fixture for pending source filtering",
      sources: [
        {
          id: "source-astrazeneca-social",
          companyId: "company-astrazeneca",
          kind: "SOCIAL",
          atsKind: "OFFICIAL_JSON",
          status: "ENTRY_FOUND_PENDING_ADAPTER",
          officialEntryUrl: "https://job-search.astrazeneca.cn/%e6%b1%82%e8%81%8c",
          officialChainEvidenceUrl: "https://www.astrazeneca.cn/careers"
        }
      ]
    };

    const plans = buildSourceCrawlPlans([pendingConfiguredCompany]);

    expect(getPlanBySourceId(plans, "source-astrazeneca-social")).toBeUndefined();
  });

  it("assigns deterministic adapter ids for representative source types", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);

    expect(getPlanBySourceId(plans, "source-astrazeneca-social")?.adapterId).toBe("html-table");
    expect(getPlanBySourceId(plans, "source-novartis-social")?.adapterId).toBe("html-table");
    expect(getPlanBySourceId(plans, "source-fosun-pharma-social")?.adapterId).toBe(
      "html-table"
    );
    expect(getPlanBySourceId(plans, "source-cspc-social")).toBeUndefined();
    const beigenePlan = getPlanBySourceId(plans, "source-beigene-social");
    expect(beigenePlan?.adapterId).toBe("official-json");
    if (beigenePlan?.adapterId !== "official-json") {
      throw new Error("Expected Beigene plan to use official-json adapter");
    }
    expect(beigenePlan.json).toMatchObject({
      jobsPath: "data.jobs",
      fields: {
        sourceJobId: "id",
        officialTitle: "title",
        officialUrl: "officialUrl",
        locationRaw: "locationRaw",
        cities: "cities"
      },
      defaultCategory: "其他"
    });
  });

  it("configures direct HTML and Moka crawl plans for wave 1 verified sources", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));
    const plannedSourceIds = new Set(plans.map((plan) => plan.source.id));

    expect(plannedSourceIds).toEqual(
      new Set([
        "source-abbott-china-social",
        "source-akeso-social",
        "source-agilent-china-social",
        "source-allist-social",
        "source-alphamab-social",
        "source-amgen-china-social",
        "source-ascentage-social",
        "source-astrazeneca-social",
        "source-bayer-healthcare-social",
        "source-boehringer-ingelheim-china-social",
        "source-cr-sanjiu-social",
        "source-edwards-china-social",
        "source-bms-china-social",
        "source-novartis-social",
        "source-fosun-pharma-social",
        "source-beigene-social",
        "source-beta-pharma-social",
        "source-cstone-social",
        "source-gehc-china-social",
        "source-gilead-china-social",
        "source-haleon-china-social",
        "source-grand-pharma-china-social",
        "source-hansoh-social",
        "source-haisco-social",
        "source-hengrui-social",
        "source-hisun-social",
        "source-huahai-social",
        "source-innovent-social",
        "source-joincare-social",
        "source-kenvue-china-social",
        "source-kelun-social",
        "source-kelun-biotech-social",
        "source-kpc-social",
        "source-mabwell-social",
        "source-medtronic-china-social",
        "source-merck-china-social",
        "source-msd-china-social",
        "source-nhwa-social",
        "source-novo-nordisk-china-social",
        "source-pfizer-china-social",
        "source-puluo-social",
        "source-rcbio-social",
        "source-roche-china-social",
        "source-sanofi-china-social",
        "source-simcere-social",
        "source-sinocelltech-social",
        "source-stryker-china-social",
        "source-takeda-china-social",
        "source-thermo-fisher-china-social",
        "source-zaiding-social"
      ])
    );

    expect(byId.get("source-astrazeneca-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: "#search-results-list li",
        fields: {
          officialTitle: { selector: "a.search-results-link h2" },
          officialUrl: { selector: "a.search-results-link", attribute: "href" },
          locationRaw: { selector: "span.job-location" }
        }
      }
    });

    expect(byId.get("source-novartis-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: "table.views-table tbody tr",
        fields: {
          officialTitle: { selector: "td.views-field-field-job-title a" },
          officialUrl: {
            selector: "td.views-field-field-job-title a",
            attribute: "href"
          },
          locationRaw: { selector: "td.views-field-field-job-work-location" }
        }
      }
    });

    expect(byId.get("source-fosun-pharma-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: "table tr",
        fields: {
          officialTitle: { selector: "td:nth-child(1) a" },
          officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
          locationRaw: { selector: "td:nth-child(4) a" }
        }
      }
    });

    expect(byId.get("source-hengrui-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs",
        officialChainEvidenceUrl: "https://www.hengrui.com/development/recruit.html"
      }
    });

    expect(byId.get("source-kelun-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://kelun.zhiye.com/social",
        officialChainEvidenceUrl: "https://www.kelun.com/intro/3.html"
      },
      table: {
        rowSelector: ".jobsTable tr:not(.title)",
        fields: {
          officialTitle: { selector: "td:nth-child(1) a" },
          officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
          locationRaw: { selector: "td:nth-child(5)" }
        }
      }
    });

    expect(byId.get("source-cspc-social")).toBeUndefined();
  });

  it("configures task 4 ATS-grouped verified source plans", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-beta-pharma-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://bettapharma.zhiye.com/Social",
        officialChainEvidenceUrl: "https://www.bettapharma.com/Jobs/"
      },
      table: {
        rowSelector: ".jobsTable tr:not(.title)",
        fields: {
          officialTitle: { selector: "td:nth-child(1) a" },
          officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
          locationRaw: { selector: "td:nth-child(3)" }
        }
      }
    });

    expect(byId.get("source-allist-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://allist.zhiye.com/Social",
        officialChainEvidenceUrl: "https://www.allist.com.cn/recruit.html"
      },
      table: {
        rowSelector: ".jobsTable tr:not(.title)",
        fields: {
          officialTitle: { selector: "td:nth-child(1) a" },
          officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
          locationRaw: { selector: "td:nth-child(3)" }
        }
      }
    });

    expect(byId.get("source-hansoh-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://hspharm.zhiye.com/Social",
        officialChainEvidenceUrl: "https://cn.hspharm.com/site/solr.htm"
      },
      table: {
        rowSelector: ".jobsTable tr:not(.title)",
        fields: {
          officialTitle: { selector: "td:nth-child(1) a" },
          officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
          locationRaw: { selector: "td:nth-child(3)" }
        }
      }
    });

    expect(byId.get("source-kelun-biotech-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "BEISEN_ZHIYE",
        officialEntryUrl: "https://kelunbotai.zhiye.com/Social",
        officialChainEvidenceUrl: "https://www.kelun-biotech.com/RecruitTalented.aspx"
      },
      table: {
        rowSelector: "tr:has(.jname a)",
        fields: {
          officialTitle: { selector: ".jname a" },
          officialUrl: { selector: ".jname a", attribute: "href" },
          locationRaw: { selector: ".jcity", attribute: "title" }
        }
      }
    });

    expect(byId.get("source-kpc-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.kpc.com.cn/job/she-hui-zhao-pin-list-0.htm",
        officialChainEvidenceUrl: "https://www.kpc.com.cn/job/index.htm"
      },
      table: {
        rowSelector: ".JobList-J1 li:not(.first)",
        fields: {
          officialTitle: { selector: "._t1" },
          officialUrl: { selector: "a", attribute: "href" },
          locationRaw: { selector: "._t4" }
        }
      }
    });

    expect(byId.get("source-mabwell-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.mabwell.com/jobs.html",
        officialChainEvidenceUrl: "https://www.mabwell.com/careers.html"
      },
      table: {
        rowSelector: ".recJob_list li",
        fields: {
          officialTitle: { selector: "a.recJob_name span:nth-child(1)" },
          officialUrl: { selector: "a.recJob_name", attribute: "href" },
          locationRaw: { selector: "a.recJob_name span:nth-child(2)" }
        }
      }
    });

    expect(byId.get("source-akeso-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.akesobio.com/cn/career/social-recruitment/",
        officialChainEvidenceUrl: "https://www.akesobio.com/cn/career/"
      },
      table: {
        rowSelector: "a.job-card",
        fields: {
          sourceJobId: { selector: ":scope", attribute: "data-content-id" },
          officialTitle: { selector: "h3" },
          officialUrl: { selector: ":scope", attribute: "href" },
          locationRaw: { selector: ":scope", attribute: "data-location" }
        }
      }
    });

    expect(byId.get("source-sanofi-china-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://jobs.sanofi.com/en/china",
        officialChainEvidenceUrl: "https://jobs.sanofi.com/en/china"
      },
      table: {
        rowSelector: ".job-list li",
        fields: {
          sourceJobId: { selector: "a", attribute: "data-job-id" },
          officialTitle: { selector: "span.job-title" },
          officialUrl: { selector: "a", attribute: "href" },
          locationRaw: { selector: "span.job-location" }
        }
      }
    });

    expect(byId.get("source-cstone-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.cstonepharma.com/join/job.html",
        officialChainEvidenceUrl: "https://www.cstonepharma.com/join/job.html"
      },
      table: {
        rowSelector: "li.wow.slideInUp",
        fields: {
          sourceJobId: { selector: "a", attribute: "href" },
          officialTitle: { selector: ".txt em" },
          officialUrl: { selector: "a", attribute: "href" },
          locationRaw: { selector: ".txt span:nth-of-type(2)" }
        }
      }
    });

    expect(byId.get("source-rcbio-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/social-recruitment/remegen/45549#/jobs",
        officialChainEvidenceUrl: "https://www.remegen.com/index.php?cid=45&v=listing"
      },
      json: {
        jobsPath: "data.jobs",
        fields: {
          sourceJobId: "id",
          officialTitle: "title",
          officialUrl: "officialUrl",
          locationRaw: "locationRaw",
          cities: "cities"
        },
        defaultCategory: "其他"
      }
    });
  });

  it("configures bulk task 6 static official html source plans", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-grand-pharma-china-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://job.grandpharma.cn/",
        officialChainEvidenceUrl: "https://job.grandpharma.cn/"
      },
      table: {
        rowSelector: ".job-card",
        fields: {
          sourceJobId: { selector: ".job-title" },
          officialTitle: { selector: ".job-title" },
          officialUrl: { value: "https://job.grandpharma.cn/" },
          locationRaw: { selector: ".job-meta span:nth-child(1)" }
        }
      }
    });

    expect(byId.get("source-joincare-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.joincare.com/Social_recruitment.html",
        officialChainEvidenceUrl: "https://www.joincare.com/Social_recruitment.html"
      },
      table: {
        rowSelector: ".job_item",
        fields: {
          sourceJobId: { selector: ".e_text-16" },
          officialTitle: { selector: ".e_text-16" },
          officialUrl: { value: "https://www.joincare.com/Social_recruitment.html" },
          locationRaw: { selector: ".cbox-13-2" }
        }
      }
    });

    expect(byId.get("source-puluo-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.apeloa.com/join.html",
        officialChainEvidenceUrl: "https://www.apeloa.com/join.html"
      },
      table: {
        rowSelector: ".join2 .table99.name",
        fields: {
          sourceJobId: { selector: "> div:nth-child(1) p" },
          officialTitle: { selector: "> div:nth-child(1) p" },
          officialUrl: { value: "https://www.apeloa.com/join.html" },
          locationRaw: { selector: "> div:nth-child(4) p" }
        }
      }
    });

    expect(byId.get("source-hisun-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.hisunpharm.com/main/recruit-list.thtml?cId=10982",
        officialChainEvidenceUrl: "https://www.hisunpharm.com/main/recruit.thtml?cId=10981"
      },
      table: {
        rowSelector: ".job_list li",
        fields: {
          sourceJobId: { selector: "a", attribute: "id" },
          officialTitle: { selector: ".job_name" },
          officialUrl: { value: "https://www.hisunpharm.com/main/recruit-list.thtml?cId=10982" },
          locationRaw: { selector: ".job_place" }
        }
      }
    });

    expect(byId.get("source-huahai-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.huahaipharm.com/zpgw.html",
        officialChainEvidenceUrl: "https://www.huahaipharm.com/zpgw.html"
      },
      table: {
        rowSelector: "tr.tr_title",
        fields: {
          sourceJobId: { selector: "td:nth-child(1)" },
          officialTitle: { selector: "td:nth-child(1)" },
          officialUrl: { value: "https://www.huahaipharm.com/zpgw.html" },
          locationRaw: { selector: "td:nth-child(2)" }
        }
      }
    });

    expect(byId.get("source-alphamab-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.alphamabonc.com/career/job.html",
        officialChainEvidenceUrl: "https://www.alphamabonc.com/career/job.html"
      },
      table: {
        rowSelector: ".s_job > ul > li",
        fields: {
          sourceJobId: { selector: ".title h2" },
          officialTitle: { selector: ".title h2" },
          officialUrl: { value: "https://www.alphamabonc.com/career/job.html" },
          locationRaw: { selector: ".title h3" }
        }
      }
    });

    expect(byId.get("source-ascentage-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://ascentage.com/careers/job-opportunities/",
        officialChainEvidenceUrl: "https://ascentage.com/careers/job-opportunities/"
      },
      table: {
        rowSelector: '.list-data:contains("Beijing")',
        fields: {
          sourceJobId: { selector: "h4 a", attribute: "href" },
          officialTitle: { selector: ".job-title" },
          officialUrl: { selector: "h4 a", attribute: "href" },
          locationRaw: { selector: ".job-location" }
        }
      }
    });

    expect(byId.get("source-nhwa-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://www.nhwa-group.com/job/ren-cai-zhao-pin-list-0.htm",
        officialChainEvidenceUrl: "https://www.nhwa-group.com/job/ren-cai-zhao-pin-list-0.htm"
      },
      table: {
        rowSelector: "._jt",
        fields: {
          sourceJobId: { selector: ".job_name" },
          officialTitle: { selector: ".job_name" },
          officialUrl: { value: "https://www.nhwa-group.com/job/ren-cai-zhao-pin-list-0.htm" },
          locationRaw: { selector: ".job_add" }
        }
      }
    });
  });

  it("configures Workday official JSON source plans", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-pfizer-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
        officialChainEvidenceUrl: "https://www.pfizer.com/about/careers"
      },
      json: {
        jobsPath: "jobPostings",
        fields: {
          sourceJobId: "sourceJobId",
          officialTitle: "title",
          officialUrl: "officialUrl",
          locationRaw: "locationRaw",
          cities: "cities"
        },
        defaultCategory: "其他"
      },
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: {
          Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"]
        },
        pageSize: 20,
        maxPages: 10
      }
    });

    expect(byId.get("source-haleon-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://gsknch.wd3.myworkdayjobs.com/GSKCareers",
        officialChainEvidenceUrl: "https://www.haleon.com/careers"
      },
      json: {
        jobsPath: "jobPostings",
        fields: {
          sourceJobId: "sourceJobId",
          officialTitle: "title",
          officialUrl: "officialUrl",
          locationRaw: "locationRaw",
          cities: "cities"
        },
        defaultCategory: "其他"
      },
      workday: {
        tenant: "gsknch",
        site: "GSKCareers",
        appliedFacets: {
          location: [
            "03fe97f04c9a01333d3739eea7577455",
            "03fe97f04c9a01ebc5af2deea7576a55",
            "15dc3becd679105e714122093995f79f",
            "b5196703399c0188e29d0aedaf53abef"
          ]
        },
        pageSize: 20,
        maxPages: 5,
        cityHints: {
          "SHANGHAI QIANTAN PLAZA": ["上海"],
          "Suzhou Plant Tech Industry Park": ["苏州"]
        }
      }
    });

    expect(byId.get("source-roche-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext",
        officialChainEvidenceUrl: "https://careers.roche.com/cn/zh/china-mainland"
      },
      workday: {
        tenant: "roche",
        site: "roche-ext",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });

    expect(byId.get("source-msd-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://msd.wd5.myworkdayjobs.com/SearchJobs",
        officialChainEvidenceUrl: "https://jobs.msd.com/cn/zh"
      },
      workday: {
        tenant: "msd",
        site: "SearchJobs",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });

    expect(byId.get("source-bms-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://bristolmyerssquibb.wd5.myworkdayjobs.com/BMS",
        officialChainEvidenceUrl: "https://careers.bms.com/cn/"
      },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });

    expect(byId.get("source-gilead-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://gilead.wd1.myworkdayjobs.com/gileadcareers",
        officialChainEvidenceUrl: "https://www.gilead.com/careers/opportunities"
      },
      workday: {
        tenant: "gilead",
        site: "gileadcareers",
        searchText: "China",
        pageSize: 20,
        maxPages: 3
      }
    });

    expect(byId.get("source-agilent-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://agilent.wd5.myworkdayjobs.com/Agilent_Careers",
        officialChainEvidenceUrl: "https://careers.agilent.com/locations/asia-pacific/china/"
      },
      workday: {
        tenant: "agilent",
        site: "Agilent_Careers",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });

    expect(byId.get("source-abbott-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://abbott.wd5.myworkdayjobs.com/abbottcareers",
        officialChainEvidenceUrl: "https://www.abbott.com/careers.html"
      },
      workday: {
        tenant: "abbott",
        site: "abbottcareers",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });

    expect(byId.get("source-stryker-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://stryker.wd1.myworkdayjobs.com/StrykerCareers",
        officialChainEvidenceUrl: "https://careers.stryker.com/"
      },
      workday: {
        tenant: "stryker",
        site: "StrykerCareers",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });

    expect(byId.get("source-gehc-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://gehc.wd5.myworkdayjobs.com/gehc_externalsite",
        officialChainEvidenceUrl: "https://www.gehealthcare.com/about/careers"
      },
      workday: {
        tenant: "gehc",
        site: "gehc_externalsite",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });

    expect(byId.get("source-edwards-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://edwards.wd5.myworkdayjobs.com/edwardscareers",
        officialChainEvidenceUrl: "https://www.edwards.com/careers/jobsearch"
      },
      workday: {
        tenant: "edwards",
        site: "edwardscareers",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });

    expect(byId.get("source-medtronic-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers",
        officialChainEvidenceUrl: "https://medtronic.wd1.myworkdayjobs.com/MedtronicCareers"
      },
      workday: {
        tenant: "medtronic",
        site: "MedtronicCareers",
        searchText: "China",
        pageSize: 20,
        maxPages: 5
      }
    });
  });

  it("configures Hotjob Wecruit official JSON source plans", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-simcere-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "HOTJOB_WECRUIT",
        officialEntryUrl: "https://wecruit.hotjob.cn/SU61458d83bef57c54dcb4e43f/pb/index.html",
        officialChainEvidenceUrl: "https://www.simcere.com/jrwm/jrwm.aspx"
      },
      json: {
        jobsPath: "jobs",
        fields: {
          sourceJobId: "sourceJobId",
          officialTitle: "title",
          officialUrl: "officialUrl",
          locationRaw: "locationRaw"
        },
        defaultCategory: "其他"
      },
      hotjob: {
        suiteKey: "SU61458d83bef57c54dcb4e43f",
        pageSize: 20,
        maxPages: 25
      }
    });

    expect(byId.get("source-haisco-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "HOTJOB_WECRUIT",
        officialEntryUrl: "https://wecruit.hotjob.cn/SU6663b85a1eb8051cd22556e3/pb/social.html",
        officialChainEvidenceUrl: "https://www.haisco.com/recruitment.html"
      },
      json: {
        jobsPath: "jobs",
        fields: {
          sourceJobId: "sourceJobId",
          officialTitle: "title",
          officialUrl: "officialUrl",
          locationRaw: "locationRaw"
        },
        defaultCategory: "其他"
      },
      hotjob: {
        suiteKey: "SU6663b85a1eb8051cd22556e3",
        pageSize: 20,
        maxPages: 10
      }
    });

    expect(byId.get("source-cr-sanjiu-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "HOTJOB_WECRUIT",
        officialEntryUrl: "https://wecruit.hotjob.cn/SU613834ecbef57c3b6383b50e/pb/index.html",
        officialChainEvidenceUrl: "https://www.999.com.cn/applicationGuide/index.html"
      },
      hotjob: {
        suiteKey: "SU613834ecbef57c3b6383b50e",
        pageSize: 20,
        maxPages: 20
      }
    });
  });

  it("configures final P0 official API and HTML source plans", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-innovent-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://www.innoventbio.com/cn/recruit",
        officialChainEvidenceUrl: "https://www.innoventbio.com/cn/recruit"
      },
      officialJsonFetch: {
        kind: "innovent",
        endpointUrl: "https://www.innoventbio.com/api/jobs?limit=200"
      }
    });

    expect(byId.get("source-novo-nordisk-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://www.novonordisk.com/careers/find-a-job/career-search-results.html",
        officialChainEvidenceUrl: "https://www.novonordisk.com/careers/find-a-job.html"
      },
      officialJsonFetch: {
        kind: "novo-nordisk",
        endpointUrl:
          "https://www.novonordisk.com/bin/nncorp/careersearch?keyword=&country=China%20Mainland&category=&locale=en"
      }
    });

    expect(byId.get("source-boehringer-ingelheim-china-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "SUCCESSFACTORS",
        officialEntryUrl: "https://jobs.boehringer-ingelheim.com/search/?q=&locationsearch=China",
        officialChainEvidenceUrl: "https://jobs.boehringer-ingelheim.com/"
      },
      table: {
        rowSelector: "#job-tile-list li.job-tile",
        fields: {
          officialTitle: { selector: ".jobTitle-link" },
          officialUrl: { selector: ".jobTitle-link", attribute: "href" },
          locationRaw: { selector: '.section-field.location div[id$="-value"]' }
        }
      }
    });

    expect(byId.get("source-merck-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://careers.emdgroup.com/us/en/search-results?keywords=China",
        officialChainEvidenceUrl: "https://careers.emdgroup.com/us/en/"
      },
      officialJsonFetch: {
        kind: "phenom",
        detailBaseUrl: "https://careers.emdgroup.com/us/en/job"
      }
    });

    expect(byId.get("source-thermo-fisher-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "OFFICIAL_JSON",
        officialEntryUrl: "https://jobs.thermofisher.com/global/en/china-jobs",
        officialChainEvidenceUrl: "https://jobs.thermofisher.com/global/en"
      },
      officialJsonFetch: {
        kind: "phenom",
        detailBaseUrl: "https://jobs.thermofisher.com/global/en/job"
      }
    });

    expect(byId.get("source-sinocelltech-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "HOTJOB_WECRUIT",
        officialEntryUrl: "https://www.hotjob.cn/wt/SCT/web/index",
        officialChainEvidenceUrl: "https://www.sinocelltech.com/Gather/job/pid/7.html"
      },
      hotjobLegacy: {
        listUrl: "https://www.hotjob.cn/wt/SCT/web/mode400/position/list",
        suitePath: "wt/SCT",
        pageSize: 20,
        maxPages: 10
      }
    });
  });

  it("configures global static HTML source plans", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-bayer-healthcare-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "SUCCESSFACTORS",
        officialEntryUrl: "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN",
        officialChainEvidenceUrl: "https://www.bayer.com.cn/zh-hans/zhaoxiannashi"
      },
      table: {
        rowSelector: "#searchresults tbody tr",
        fields: {
          officialTitle: { selector: ".jobTitle.hidden-phone a.jobTitle-link" },
          officialUrl: {
            selector: ".jobTitle.hidden-phone a.jobTitle-link",
            attribute: "href"
          },
          locationRaw: { selector: "td.colLocation" }
        }
      }
    });

    expect(byId.get("source-takeda-china-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://jobs.takeda.com/location/china-jobs/1113/1814991/2",
        officialChainEvidenceUrl: "https://www.takeda.com/careers/"
      },
      table: {
        rowSelector: "#search-results-list li",
        fields: {
          sourceJobId: { selector: "button.js-save-job-btn", attribute: "data-job-id" },
          officialTitle: { selector: "h2.title" },
          officialUrl: { selector: "a[href*='/job/']", attribute: "href" },
          locationRaw: { selector: ".location" }
        }
      }
    });
  });

  it("configures Kenvue Workday and Zai Lab HTML source plans", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-kenvue-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://kenvue.wd5.myworkdayjobs.com/kenvue",
        officialChainEvidenceUrl: "https://www.kenvue.com/careers"
      },
      json: {
        jobsPath: "jobPostings",
        fields: {
          sourceJobId: "sourceJobId",
          officialTitle: "title",
          officialUrl: "officialUrl",
          locationRaw: "locationRaw",
          cities: "cities"
        },
        defaultCategory: "其他"
      },
      workday: {
        tenant: "kenvue",
        site: "kenvue",
        appliedFacets: {
          locationCountry: ["6cb77610a8a543aea2d6bc10457e35d4"]
        },
        pageSize: 20,
        maxPages: 2
      }
    });

    expect(byId.get("source-zaiding-social")).toMatchObject({
      adapterId: "html-table",
      source: {
        atsKind: "OFFICIAL_HTML",
        officialEntryUrl: "https://cn.zailaboratory.com/jobs/",
        officialChainEvidenceUrl: "https://cn.zailaboratory.com/careers/"
      },
      table: {
        rowSelector: ".space-y-2 > .bg-white",
        fields: {
          officialTitle: { selector: ".font-bold.text-black.text-xl" },
          officialUrl: { value: "https://cn.zailaboratory.com/jobs/" },
          locationRaw: { selector: ".font-normal.mt-2" }
        }
      }
    });
  });

  it("configures Amgen Workday source plan", () => {
    const plans = buildSourceCrawlPlans(candidateCompanies);
    const byId = new Map(plans.map((plan) => [plan.source.id, plan]));

    expect(byId.get("source-amgen-china-social")).toMatchObject({
      adapterId: "official-json",
      source: {
        atsKind: "WORKDAY",
        officialEntryUrl: "https://amgen.wd1.myworkdayjobs.com/Careers",
        officialChainEvidenceUrl: "https://www.amgen.com/careers"
      },
      workday: {
        tenant: "amgen",
        site: "Careers",
        appliedFacets: {
          LocationCountry: ["6cb77610a8a543aea2d6bc10457e35d4"]
        },
        pageSize: 20,
        maxPages: 3
      }
    });
  });
});
