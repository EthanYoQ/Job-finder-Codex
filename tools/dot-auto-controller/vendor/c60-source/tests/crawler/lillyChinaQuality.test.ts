import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { captureSyntheticLilly, lillyPlan, replayLilly, syntheticLillyRow } from "../helpers/lillyPhenom";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";

describe("Lilly China source quality", () => {
  it("preserves exact old official dates and reviewed Shanghai geometry", async () => {
    const input = await captureSyntheticLilly();
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs).toMatchObject([{cities: ["上海"], officialPublishedAt: "2025-11-12T00:00:00.000Z"}]);
    expect(replayLilly(input)).toBe(true);
  });
  it("accepts whitespace-only title changes while retaining the exact raw body", async () => {
    const title = " \tSenior  Associate,\nQuality   Assurance \t";
    const input = await captureSyntheticLilly([syntheticLillyRow(0, {title})]);
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs[0]).toMatchObject({officialTitle: "Senior Associate, Quality Assurance", cities: ["上海"]});
    const artifact = input.result.fetchEvidence!.artifacts.find(a => a.logicalKey === "phenom-page-0000")!;
    expect(JSON.parse(artifact.body as string).refineSearch.data.jobs[0].title).toBe(title);
    expect(input.result.fetchEvidence!.pages[0]!.responseFingerprintSha256).toBe(createHash("sha256").update(artifact.body).digest("hex"));
    expect(replayLilly(input)).toBe(true);
  });
  it.each([
    ["sourceKind", "CAMPUS"], ["atsKind", "OFFICIAL_HTML"], ["officialChineseCompanyName", "Other Company"],
    ["listUrl", "https://careers.lilly.com/other"], ["category", "研发"], ["auxiliaryChineseTitle", "Added title"],
    ["extraMetadata", "unreviewed"], ["evidence.officialEntryUrl", "https://careers.lilly.com/other"],
    ["evidence.officialChainEvidenceUrl", "https://careers.lilly.com/other"], ["evidence.rawSnapshotRef", "unreviewed-snapshot"],
    ["evidence.extraEvidence", "unreviewed"], ["evidence.astellasPdfLocation", {country: "中国", status: "CITY_SPECIFIC"}]
  ])("rejects changed or added complete-output metadata %s", async (field, value) => {
    const input = await captureSyntheticLilly(); expect(replayLilly(input)).toBe(true);
    const jobs = structuredClone(input.result.jobs), job = jobs[0]!;
    if (String(field).startsWith("evidence.")) (job.evidence as unknown as Record<string, unknown>)[String(field).slice(9)] = value;
    else (job as unknown as Record<string, unknown>)[String(field)] = value;
    expect(replayLilly(input, jobs)).toBe(false);
  });
  it("allows either legitimate baseline boolean without allowing missing or nonboolean metadata", async () => {
    const input = await captureSyntheticLilly(); expect(replayLilly(input)).toBe(true);
    expect(replayLilly(input, input.result.jobs.map(job => ({...job, isBaseline: true})))).toBe(true);
    for (const field of ["sourceKind", "atsKind", "officialChineseCompanyName", "listUrl", "category", "isBaseline"]) {
      const jobs = structuredClone(input.result.jobs); delete (jobs[0] as unknown as Record<string, unknown>)[field];
      expect(replayLilly(input, jobs), field).toBe(false);
    }
    const jobs = structuredClone(input.result.jobs); (jobs[0] as unknown as Record<string, unknown>).isBaseline = "true";
    expect(replayLilly(input, jobs)).toBe(false);
  });
  it("keeps reviewed URL city contradictions pending without changing official text", async () => {
    const row = syntheticLillyRow(); row.applyUrl = String(row.applyUrl).replace("China-Shang-Hai-", "China-Bei-Jing-");
    const input = await captureSyntheticLilly([row]);
    expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs[0]?.cities).toEqual(["城市待核"]);
    expect(replayLilly(input)).toBe(true);
  });
  it.each([{officialTitle: "Forged"}, {officialPublishedAt: "2026-10-01T00:00:00.000Z"}, {cities: ["北京"]},
    {cities: ["上海", "城市待核"]}, {officialUrl: "https://lilly.wd115.myworkdayjobs.com/LLY/job/China-Shang-Hai-/Scientist_R-999999/apply"}])("rejects changed normalized output %j", async mutation => {
    const input = await captureSyntheticLilly(); expect(replayLilly(input, input.result.jobs.map(job => ({...job, ...mutation})))).toBe(false);
  });
  it.each([{workLocations: [{country: "Singapore"}]}, {siteType: "internal"}, {visibilityType: "Internal"}, {jobVisibility: ["internal"]},
    {country: "Singapore"}, {postedDate: "bad"}])("rejects raw source attacks %j", async mutation => {
    const input = await captureSyntheticLilly([syntheticLillyRow(0, mutation)]);
    expect(input.result.truth.completenessVerified).toBe(false); expect(input.result.jobs).toEqual([]);
  });
  it("rejects appended foreign nested work location even after corporate headquarters prose", async () => {
    const row = syntheticLillyRow(), nested = row.ml_job_parser as Record<string, string>;
    nested.descriptionTeaser_keyword += " Work location: Singapore.";
    expect((await captureSyntheticLilly([row])).result.truth.completenessVerified).toBe(false);
  });
  it("preserves contradictory Suzhou and remote Zhejiang shapes without guessing workplaces", async () => {
    const suzhou = syntheticLillyRow(1, {city: "Suzhou", state: "Shanghai", location: "Suzhou, Shanghai, China", cityState: "Suzhou, Shanghai",
      cityStateCountry: "Suzhou, Shanghai, China", latitude: "31.31092", longitude: "120.77415", address: "No.109, Fangzhong Jie SIP, Suzhou, 215126 Shanghai, China",
      multi_location: ["Suzhou, Shanghai, China"], multi_location_array: [{location: "Suzhou, Shanghai, China", latlong: {lat: 31.311389, lon: 120.618056}}]});
    const zhejiang = syntheticLillyRow(2, {city: "Zhejiang", state: "Zhejiang", location: "Zhejiang, Zhejiang, China", cityState: "Zhejiang, Zhejiang",
      cityStateCountry: "Zhejiang, Zhejiang, China", latitude: "0.0", longitude: "0.0", address: "Remote, Zhejiang, 999999 Zhejiang, China",
      multi_location: ["Zhejiang, Zhejiang, China"], multi_location_array: [{location: "Zhejiang, Zhejiang, China", latlong: {lat: Number.MIN_VALUE, lon: Number.MIN_VALUE}}]});
    const input = await captureSyntheticLilly([suzhou, zhejiang]);
    expect(input.result.truth.completenessVerified).toBe(true); expect(input.result.jobs.map(j => j.cities)).toEqual([["城市待核"], ["城市待核"]]);
    expect(replayLilly(input)).toBe(true);
  });
  it("retains duplicate identical alternatives as one job with one city", async () => {
    const row = syntheticLillyRow(); (row.multi_location as unknown[]).push("Shanghai, Shanghai, China");
    (row.multi_location_array as unknown[]).push(structuredClone((row.multi_location_array as unknown[])[0]));
    const input = await captureSyntheticLilly([row]); expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs).toHaveLength(1); expect(input.result.jobs[0]?.cities).toEqual(["上海"]); expect(replayLilly(input)).toBe(true);
  });
  it.each([
    {country: "China / Singapore"}, {city: "Boston"}, {state: "Atlantis"}, {location: "Shanghai, Singapore"}, {cityState: "Shanghai, Boston"},
    {cityStateCountry: "China"}, {address: "Workplace Singapore"}, {latitude: "42.3601"}, {longitude: "-71.0589"}, {isMultiLocation: false},
    {multi_location: ["Shanghai, Shanghai, China", "Singapore"]}, {multi_location: []}, {multi_location_array: []},
    {multi_location_array: [{location: "Shanghai, Shanghai, China", latlong: {lat: 42.3601, lon: 121.45806}}]},
    {multi_location_array: [{location: "Shanghai, Shanghai, China", country: "US", latlong: {lat: 31.22222, lon: 121.45806}}]},
    {multi_location_array: [{location: "Shanghai, Shanghai, China", latlong: {lat: 31.22222, lon: 121.45806, city: "Boston"}}]},
    {workLocations: []}, {locations: ["Shanghai"]}, {countryCode: "US"}, {futureUnknownField: "unknown"},
    {category: {location: "Singapore"}}, {ml_skills: [{location: "Singapore"}]}, {multi_category_array: [{category: "Medical", location: "Singapore"}]},
    {jobId: "R-900001"}, {reqId: "R-900001"}, {jobSeqNo: "LILLUSR900001EXTERNALENUS"}, {jobVisibility: ["external", "unknown"]},
    {jobVisibility: ["external", "external"]}, {externalApply: true}, {locale: "zh_CN"},
    {dateCreated: "Work location: Singapore."}
  ])("holds unsupported identity, visibility, or geography %j", async mutation => {
    const input = await captureSyntheticLilly([syntheticLillyRow(0, mutation)]);
    expect(input.result.truth.completenessVerified).toBe(false); expect(input.result.jobs).toEqual([]);
  });
  it.each(["country", "city", "state", "location", "cityState", "cityStateCountry", "address", "latitude", "longitude", "multi_location", "multi_location_array", "isMultiLocation",
    "reqId", "jobId", "jobSeqNo", "siteType", "visibilityType", "jobVisibility", "externalApply", "locale", "descriptionTeaser", "ml_job_parser", "postedDate"])("holds missing required raw field %s", async field => {
    const row = syntheticLillyRow(); delete row[field]; const input = await captureSyntheticLilly([row]);
    expect(input.result.truth.completenessVerified).toBe(false); expect(input.result.jobs).toEqual([]);
  });
  it.each(["http://lilly.wd115.myworkdayjobs.com/LLY/job/China-Shang-Hai-/Scientist_R-800000/apply",
    "https://lilly.wd115.myworkdayjobs.com.evil.example/LLY/job/China-Shang-Hai-/Scientist_R-800000/apply",
    "https://lilly.wd115.myworkdayjobs.com/OTHER/job/China-Shang-Hai-/Scientist_R-800000/apply",
    "https://lilly.wd115.myworkdayjobs.com/LLY/job/China-Atlantis-/Scientist_R-800000/apply",
    "https://lilly.wd115.myworkdayjobs.com/LLY/job/US-Boston/Scientist_R-800000/apply",
    "https://lilly.wd115.myworkdayjobs.com/LLY/job/China-Shang-Hai-/Scientist_R-800001/apply",
    "https://lilly.wd115.myworkdayjobs.com/LLY/job/China-Shang-Hai-/Scientist_R-800000/apply?from=other",
    "https://lilly.wd115.myworkdayjobs.com/LLY/job/China-Shang-Hai-/Scientist_R-800000/apply#other",
    "https://lilly.wd115.myworkdayjobs.com/LLY/job/China-Shang-Hai-/Scientist_R-800000/apply/"
  ])("rejects official URL drift %s", async applyUrl => {
    const input = await captureSyntheticLilly([syntheticLillyRow(0, {applyUrl})]); expect(input.result.truth.completenessVerified).toBe(false); expect(input.result.jobs).toEqual([]);
  });
  it.each([undefined, null, "", 0, "2026-09-29", "2026-09-29T12:05:11.334", "2026-02-29T00:00:00.000+0000"])("rejects unusable official dates without dateCreated fallback %j", async postedDate => {
    expect((await captureSyntheticLilly([syntheticLillyRow(0, {postedDate})])).result.truth.completenessVerified).toBe(false);
  });
  it("preserves a non-UTC old timestamp precisely without applying an age window", async () => {
    const input = await captureSyntheticLilly([syntheticLillyRow(0, {postedDate: "2001-01-01T05:54:14.123+0800"})]);
    expect(input.result.jobs[0]?.officialPublishedAt).toBe("2000-12-31T21:54:14.123Z"); expect(replayLilly(input)).toBe(true);
  });
  it.each(["descriptionTeaser_first200", "descriptionTeaser_keyword", "descriptionTeaser_ats"])("rejects appended arbitrary work location in nested field %s", async field => {
    for (const clause of [" Work location: Singapore.", " This job is in Boston.", " Office: Boston.", " 工作地点：新加坡"]) {
      const row = syntheticLillyRow(); (row.ml_job_parser as Record<string, string>)[field] += clause;
      expect((await captureSyntheticLilly([row])).result.truth.completenessVerified, clause).toBe(false);
    }
  });
  it.each(["This role will work in Singapore.", "Singapore-based pharmaceutical quality role.", "The successful candidate will be stationed in Singapore.",
    "Office address: Singapore.", "You will work from Singapore.", "岗位驻地：新加坡。", "本职位在新加坡。",
    "This role is physically based out of Singapore.", "The job requires relocation to Singapore.", "本职位工作地点为新加坡。",
    "Your workplace is Singapore.", "工作地点是新加坡。", "工作地点在新加坡。", "Work location Singapore", "Work location:Singapore.",
    "Work location:Shanghai. Work location:Singapore.", "This role is not only based in Singapore but also in Shanghai."])("holds explicit foreign workplace prose: %s", async descriptionTeaser => {
    const row = syntheticLillyRow(0, {descriptionTeaser}); (row.ml_job_parser as Record<string, string>).descriptionTeaser = descriptionTeaser;
    expect((await captureSyntheticLilly([row])).result.truth.completenessVerified).toBe(false);
  });
  it.each(["The role is based in Shanghai and supports Singapore clients.", "You will work in Shanghai on our Singapore product strategy.",
    "This role requires working in close collaboration with Singapore colleagues.", "The role is not based in Singapore; it is based in Shanghai."])("retains business responsibility, collaboration, and negation without claiming a foreign workplace: %s", async descriptionTeaser => {
    const row = syntheticLillyRow(0, {descriptionTeaser}); (row.ml_job_parser as Record<string, string>).descriptionTeaser = descriptionTeaser;
    const input = await captureSyntheticLilly([row]); expect(input.result.truth.completenessVerified).toBe(true); expect(replayLilly(input)).toBe(true);
  });
  it.each(["Scientist - Singapore - Quality Assurance", "Quality Scientist (Singapore)", "Scientist - Atlantis"])("retains title-only geography with city pending: %s", async title => {
    const input = await captureSyntheticLilly([syntheticLillyRow(0, {title})]);
    expect(input.result.truth.completenessVerified).toBe(true); expect(input.result.jobs[0]?.cities).toEqual(["城市待核"]); expect(replayLilly(input)).toBe(true);
  });
  it.each(["Scientist (Beijing)", "区域经理（北京）", "医药代表/北京/上海", "Beijing Medical Representative", "区域经理-北京-免疫产品组", "Scientist (Atlantis)"])("keeps conflicting or unresolved title geography pending in any segment: %s", async title => {
    const input = await captureSyntheticLilly([syntheticLillyRow(0, {title})]); expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs[0]?.cities).toEqual(["城市待核"]); expect(replayLilly(input)).toBe(true);
  });
  it.each(["microsoft office", "value-based pricing"])("keeps reviewed professional skill context separate from workplace %s", async skill => {
    const input = await captureSyntheticLilly([syntheticLillyRow(0, {ml_skills: [skill]})]); expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs[0]?.cities).toEqual(["上海"]); expect(replayLilly(input)).toBe(true);
  });
  it("does not exempt foreign workplace text appended to a reviewed professional skill", async () => {
    for (const skill of ["microsoft office. Work location: Singapore.", "value-based pricing. Office address: Boston."]) {
      expect((await captureSyntheticLilly([syntheticLillyRow(0, {ml_skills: [skill]})])).result.truth.completenessVerified).toBe(false);
    }
  });
  it.each(["Work location: Shanghai, but the job is based in Singapore.", "Work location: Shanghai and Singapore."])("checks appended or additional explicit workplaces: %s", async descriptionTeaser => {
    const row = syntheticLillyRow(0, {descriptionTeaser}); (row.ml_job_parser as Record<string, string>).descriptionTeaser = descriptionTeaser;
    expect((await captureSyntheticLilly([row])).result.truth.completenessVerified).toBe(false);
  });
  it.each([{category: "Work location: Singapore."}, {type: "Work location: Singapore."}, {workerSubType: "Work location: Singapore."},
    {badge: "Work location: Singapore."}, {ml_skills: ["Work location: Singapore."]}, {multi_category: ["Work location: Singapore."]},
    {multi_category_array: [{category: "Work location: Singapore."}]}])("holds misplaced geography prose in known ancillary fields %j", async mutation => {
    expect((await captureSyntheticLilly([syntheticLillyRow(0, mutation)])).result.truth.completenessVerified).toBe(false);
  });
  it.each(["Work location: Singapore.", "This position is based in Boston.", "Office location: Singapore.", "工作地点：新加坡", "Singapore based Scientist"])("holds explicit unreviewed location in top and matching nested teaser %s", async descriptionTeaser => {
    const row = syntheticLillyRow(0, {descriptionTeaser}); (row.ml_job_parser as Record<string, string>).descriptionTeaser = descriptionTeaser;
    expect((await captureSyntheticLilly([row])).result.truth.completenessVerified).toBe(false);
  });
  it.each(["Scientist based in Singapore", "Work location: Boston", "Singapore based Scientist"])("holds unsupported title geography %s", async title => {
    expect((await captureSyntheticLilly([syntheticLillyRow(0, {title})])).result.truth.completenessVerified).toBe(false);
  });
  it("rejects mismatched, missing, and new shadow nested fields", async () => {
    for (const mutation of ["mismatch", "missing", "new"]) {
      const row = syntheticLillyRow(), nested = row.ml_job_parser as Record<string, string>;
      if (mutation === "mismatch") nested.descriptionTeaser = "different";
      if (mutation === "missing") delete nested.descriptionTeaser_keyword;
      if (mutation === "new") nested.workLocation = "Singapore";

      expect((await captureSyntheticLilly([row])).result.truth.completenessVerified, mutation).toBe(false);
    }
  });
  it("admits a new legitimate title and new description without a text allowlist", async () => {
    const title = "Novel Translational Science Program Leader", descriptionTeaser = "Develop new research methods and coordinate a cross-functional scientific team.";
    const row = syntheticLillyRow(789, {title, descriptionTeaser});
    (row.ml_job_parser as Record<string, string>).descriptionTeaser = descriptionTeaser;
    (row.ml_job_parser as Record<string, string>).descriptionTeaser_ats = "Novel source introduction describing this research role.";
    const input = await captureSyntheticLilly([row]); expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs[0]).toMatchObject({officialTitle: title, cities: ["城市待核"]}); expect(replayLilly(input)).toBe(true);
  });
  it.each(["Work location: Atlantis.", "Remote work.", "工作地点：北京", "at our Suzhou site", "business units in Shanghai"])("retains uncertain or conflicting prose as pending: %s", async descriptionTeaser => {
    const row = syntheticLillyRow(0, {descriptionTeaser});
    (row.ml_job_parser as Record<string, string>).descriptionTeaser = descriptionTeaser;
    // A new description in a nested surface is uncertainty too; it never drops a positively China row.
    (row.ml_job_parser as Record<string, string>).descriptionTeaser_ats = descriptionTeaser;
    const input = await captureSyntheticLilly([row]); expect(input.result.truth.completenessVerified).toBe(true);
    expect(input.result.jobs[0]?.cities).toEqual(["城市待核"]); expect(replayLilly(input)).toBe(true);
  });
  it("keeps an observed empty URL title slug and optional numeric requisition version", async () => {
    const row = syntheticLillyRow(); row.applyUrl = String(row.applyUrl).replace("Synthetic-Quality-Scientist_R-800000", "_R-800000-1");
    const input = await captureSyntheticLilly([row]); expect(input.result.truth.completenessVerified).toBe(true); expect(replayLilly(input)).toBe(true);
  });
  it("closes dynamic omitted-offset pages at the exact remainder and keeps an empty response honest", async () => {
    for (const size of [0, 1, 50, 55, 100]) {
      const input = await captureSyntheticLilly(Array.from({length: size}, (_, i) => syntheticLillyRow(i)));
      expect(input.result.truth.completenessVerified, String(size)).toBe(true); expect(input.result.jobs).toHaveLength(size);
      expect(replayLilly(input)).toBe(true); expect(input.requests).toHaveLength(Math.max(1, Math.ceil(size / 50)) + 1);
    }
  });
  it("rejects offset drift, total drift, underfilled pages, and repeated raw identities", async () => {
    const rows = Array.from({length: 55}, (_, i) => syntheticLillyRow(i));
    for (const options of [{pages: [rows.slice(0, 49), rows.slice(49)]}, {totals: [55, 56]}, {pages: [rows.slice(0, 50), rows.slice(0, 5)]}, {from: 50}]) {
      expect((await captureSyntheticLilly(rows, options)).result.truth.completenessVerified).toBe(false);
    }
    expect((await captureSyntheticLilly([syntheticLillyRow(), syntheticLillyRow()])).result.truth.completenessVerified).toBe(false);
  });
  it.each(["country", "deviceType", "locale", "refNum", "pageName", "pageId", "widgetApiEndpoint"])("rejects effective bootstrap drift %s", async field => {
    expect((await captureSyntheticLilly(undefined, {bootstrap: {[field]: "unknown"}})).result.truth.completenessVerified).toBe(false);
  });
  it.each(["postedDatePolicy", "cityScopePolicy", "publicVisibilityPolicy", "countryFilter", "pageSize", "maxPages", "detailBaseUrl", "allowedApplyOrigins"])("rejects removed plan field %s", async field => {
    const plan = lillyPlan(); if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") throw Error();
    delete (plan.officialJsonFetch as unknown as Record<string, unknown>)[field];
    expect((await captureSyntheticLilly(undefined, {plan})).result.truth.completenessVerified).toBe(false);
  });
  it.each([{country: ["Singapore"]}, {country: ["China", "Singapore"]}, {}, {country: ["China"], category: ["Medical"]}])("rejects response country selection drift %j", async selection => {
    expect((await captureSyntheticLilly(undefined, {selection})).result.truth.completenessVerified).toBe(false);
  });
  it.each([{status: 500}, {status: undefined}, {hits: 0}, {hits: undefined}])("rejects contradictory response status/hits %j", async changes => {
    const row = syntheticLillyRow(); const body = JSON.stringify({refineSearch: {status: 200, hits: 1, totalHits: 1, ...changes,
      data: {jobs: [row], aggregations: [], ui_selections: {country: ["China"]}}}});
    expect((await captureSyntheticLilly([row], {bodies: [body]})).result.truth.completenessVerified).toBe(false);
  });
  it.each(["request locator", "request URL", "sequence", "returned offset", "next signal", "termination", "extra artifact", "extra page"])("rejects replay pagination/request drift %s", async mutation => {
    const input = await captureSyntheticLilly(); expect(replayLilly(input)).toBe(true);
    const evidence = structuredClone(input.result.fetchEvidence!), page = evidence.pages[0]!, artifact = evidence.artifacts[1]!;
    if (mutation === "request locator") artifact.extractorLocator += "-modified";
    if (mutation === "request URL") artifact.requestedUrl = "https://careers.lilly.com/other";
    if (mutation === "sequence") page.sequence = 1;
    if (mutation === "returned offset") page.returnedOffset = 50;
    if (mutation === "next signal") page.nextPageSignalAfter = "offset:50";
    if (mutation === "termination") page.termination = "CONTINUE";
    if (mutation === "extra artifact") evidence.artifacts.push({...artifact, logicalKey: "extra"});
    if (mutation === "extra page") evidence.pages.push(structuredClone(page));
    expect(replayLilly(input, input.result.jobs, evidence)).toBe(false);
  });
  it.each([{title: "Forged"}, {postedDate: "2026-09-28T00:00:00.000+0000"}, {workLocations: [{country: "Singapore"}]},
    {ml_job_parser: {descriptionTeaser: "Work location: Singapore."}}])("rejects coherent raw mutation after recomputing page fingerprints %j", async mutation => {
    const input = await captureSyntheticLilly(), evidence = structuredClone(input.result.fetchEvidence!);
    const artifact = evidence.artifacts[1]!, body = JSON.parse(artifact.body as string); Object.assign(body.refineSearch.data.jobs[0], mutation); artifact.body = JSON.stringify(body);
    evidence.pages[0]!.responseFingerprintSha256 = createHash("sha256").update(artifact.body).digest("hex");
    const coherent = deriveCanonicalPaginationEvidence({evidence, expectedChannelIds: [], filteredOutput: true});
    const evaluation = evaluatePaginationEvidence({evidence: coherent, expectedChannelIds: [], filteredOutput: true}); expect(evaluation.safeCompleteness).toBe(true);
    expect(replayStrictSourceQualityEvidence({plan: input.plan, evidence: coherent, jobs: input.result.jobs, paginationEvaluation: evaluation,
      reconciliation: input.result.reconciliation!, capturedAt: input.result.observation.crawledAt.toISOString()})).toBe(false);
  });
});
