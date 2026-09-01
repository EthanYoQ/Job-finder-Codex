import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { companyRecruitmentExecutionConfigsBySourceId } from "../../src/crawler/companyRecruitmentProfiles";

const config = (sourceId: string) => companyRecruitmentExecutionConfigsBySourceId[sourceId] as any;
const company = (companyId: string) => candidateCompanies.find(({ id }) => id === companyId)!;

describe("human-verified recruitment scope profiles", () => {
  it("does not silently exclude public worker or student job types", () => {
    for (const sourceId of [
      "source-pfizer-china-social",
      "source-amgen-china-social",
      "source-biogen-china-social"
    ]) {
      expect(config(sourceId).workday.facetDescriptorBoundary).toBeUndefined();
    }
    expect(config("source-johnson-innovative-medicine-social")).toMatchObject({
      profileBoundSource: {
        kind: "jnj-careers-china",
        config: {
          country: "China",
          officialSearchUrl: "https://www.careers.jnj.com/en/jobs/?search=&country=China&pagesize=20",
          scopePolicy: "GROUP_CHINA_ALL_BUSINESSES_V1"
        }
      }
    });
    for (const sourceId of ["source-roche-china-social", "source-ucb-china-social", "source-merck-china-social"]) {
      const fetchConfig = config(sourceId).officialJsonFetch;
      const scope = fetchConfig.facetScope;
      expect(fetchConfig.countryFilter ?? scope?.countryIncludeDescriptor).toBeTruthy();
      expect(scope?.categoryExcludeDescriptors ?? []).toEqual([]);
      expect(scope?.exclusionFacet).toBeUndefined();
      expect(scope?.includeFacet).toBeUndefined();
    }
  });

  it("uses the manually verified ATS and public scope for the known large mismatches", () => {
    expect(config("source-bms-china-social").officialJsonFetch).toMatchObject({
      kind: "eightfold-pcsx",
      location: "china"
    });
    expect(config("source-csl-china-social").workday).toMatchObject({
      tenant: "csl",
      site: "CSL_External"
    });
    expect(config("source-novo-nordisk-china-social").officialJsonFetch.endpointUrl).toContain("country=China");
    expect(config("source-novo-nordisk-china-social").officialJsonFetch.endpointUrl).not.toContain("China%20Mainland");
    expect(config("source-cspc-social").officialJsonFetch.channels).toEqual([
      { channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5", purpose: "SOCIAL" }
    ]);
    expect(config("source-qilu-social")).toMatchObject({
      adapterId: "html-table",
      table: {
        rowSelector: ".e_loop-65 .cbox-65.p_loopitem",
        completenessProof: { kind: "STATIC_PUBLIC_LIST" }
      }
    });
    expect(config("source-fosun-pharma-social")).toMatchObject({
      adapterId: "official-json",
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        geographyScope: "DOMESTIC_OFFICIAL_TENANT"
      }
    });
  });

  it("binds the two six-month public lists and the corrected Aspen identity", () => {
    expect(config("source-hansoh-social").officialJsonFetch.changedWithinDays).toBe(183);
    expect(config("source-united-lab-social").officialJsonFetch.changedWithinDays).toBe(183);
    expect(company("company-sandoz-china")).toMatchObject({
      officialChineseName: "爱施健（原山德士中国业务）",
      officialWebsiteUrl: "https://www.aspenpharma.cn/"
    });
    expect(company("company-sandoz-china").sources[0]?.officialEntryUrl).toBe(
      "https://www.aspenpharma.cn/careers-at-aspen/aspen-cnjobs/"
    );
  });
});
