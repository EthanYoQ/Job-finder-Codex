export interface CoverageRequest {
  keyword: string;
}

export interface CoverageCompany {
  id: string;
  companyName: string;
  officialWebsiteUrl: string;
}

export interface CoverageResult {
  companies: CoverageCompany[];
}

type CoverageRow = {
  id: string;
  officialChineseName: string;
  officialWebsiteUrl: string | null;
  pinyinName: string;
};

export interface CoverageDb {
  company: {
    findMany(args?: {
      select?: {
        id: true;
        officialChineseName: true;
        officialWebsiteUrl: true;
        pinyinName: true;
      };
    }): Promise<CoverageRow[]>;
  };
}

export async function listCompanyCoverage(request: CoverageRequest, db: CoverageDb): Promise<CoverageResult> {
  const keyword = request.keyword.trim().toLocaleLowerCase("zh-CN");
  const rows = await db.company.findMany({
    select: {
      id: true,
      officialChineseName: true,
      officialWebsiteUrl: true,
      pinyinName: true
    }
  });

  const companies = rows
    .filter((row) => row.officialWebsiteUrl !== null && row.officialWebsiteUrl.trim() !== "")
    .filter((row) => {
      if (keyword === "") {
        return true;
      }

      return (
        row.officialChineseName.toLocaleLowerCase("zh-CN").includes(keyword) ||
        row.pinyinName.toLocaleLowerCase("zh-CN").includes(keyword)
      );
    })
    .sort((left, right) => left.pinyinName.localeCompare(right.pinyinName, "zh-CN"))
    .map((row) => ({
      id: row.id,
      companyName: row.officialChineseName,
      officialWebsiteUrl: row.officialWebsiteUrl as string
    }));

  return { companies };
}
