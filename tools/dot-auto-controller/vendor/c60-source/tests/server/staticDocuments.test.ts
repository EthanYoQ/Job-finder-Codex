import { describe, expect, it } from "vitest";
import { getStaticDocument } from "../../src/server/staticDocuments";

describe("static policy documents", () => {
  it("serves consent-safe privacy and terms text with anti-crawl language", () => {
    expect(getStaticDocument("privacy").body).toContain("跨境合规事项仍需法律复核");
    expect(getStaticDocument("terms").body).toContain("禁止抓取、批量复制、转售或商业化复用");
  });

  it("describes the concrete data categories, purposes, access controls, and retention periods", () => {
    const privacy = getStaticDocument("privacy").body;

    expect(privacy).toContain("同意状态");
    expect(privacy).toContain("筛选条件");
    expect(privacy).toContain("请求元数据");
    expect(privacy).toContain("反馈与推荐");
    expect(privacy).toContain("管理员审计");
    expect(privacy).toContain("职位公开文本");
    expect(privacy).toContain("不收集简历、身份证");
    expect(privacy).toContain("最小权限");
    expect(privacy).toContain("90 天");
    expect(privacy).toContain("180 天");
    expect(privacy).toContain("2 年");
    expect(privacy).toContain("法律义务或安全事件");
  });

  it("provides an actionable export and deletion process without claiming legal sign-off", () => {
    const privacy = getStaticDocument("privacy").body;

    expect(privacy).toContain("站内反馈");
    expect(privacy).toContain("隐私数据导出");
    expect(privacy).toContain("隐私数据删除");
    expect(privacy).toContain("身份核验");
    expect(privacy).toContain("确认范围");
    expect(privacy).toContain("处理结果");
    expect(privacy).toContain("跨境法律复核尚未完成");
    expect(privacy).not.toContain("已完成合规");
  });

  it("explains anti-abuse logging, official redirects, and limits of AI assistance", () => {
    const privacy = getStaticDocument("privacy").body;

    expect(privacy).toContain("反滥用");
    expect(privacy).toContain("限流");
    expect(privacy).toContain("安全调查");
    expect(privacy).toContain("第三方官方招聘入口");
    expect(privacy).toContain("辅助翻译");
    expect(privacy).toContain("岗位分类");
    expect(privacy).toContain("仅供参考");
    expect(privacy).toContain("官方来源为准");
  });
});
