import type { OfficialJsonConfig } from "../adapters/types";
export {
  BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES,
  BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
  GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES,
  JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES,
  JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES
} from "../workdaySourceFetch";

export const MOKA_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "data.jobs",
  fields: {
    sourceJobId: "id",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw",
    cities: "cities"
  },
  defaultCategory: "其他"
};

export const MOKA_RECENT_JSON_CONFIG: OfficialJsonConfig = {
  ...MOKA_JSON_CONFIG,
  fields: {
    ...MOKA_JSON_CONFIG.fields,
    officialPublishedAt: "officialPublishedAt"
  }
};

export const WORKDAY_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "jobPostings",
  fields: {
    sourceJobId: "sourceJobId",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw",
    cities: "cities"
  },
  defaultCategory: "其他"
};

export const HOTJOB_WECRUIT_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "jobs",
  fields: {
    sourceJobId: "sourceJobId",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw"
  },
  defaultCategory: "其他"
};

export const OFFICIAL_API_JSON_CONFIG: OfficialJsonConfig = {
  jobsPath: "jobs",
  fields: {
    sourceJobId: "sourceJobId",
    officialTitle: "title",
    officialUrl: "officialUrl",
    locationRaw: "locationRaw",
    cities: "cities"
  },
  defaultCategory: "其他"
};

export const CHROME_LIKE_HTML_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
} satisfies Record<string, string>;
