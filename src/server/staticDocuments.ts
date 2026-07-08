export interface StaticDocument {
  slug: "privacy" | "terms";
  title: string;
  body: string;
}

const DOCUMENTS: Record<StaticDocument["slug"], StaticDocument> = {
  privacy: {
    slug: "privacy",
    title: "隐私说明",
    body: [
      "本服务在用户明确同意前，不提供职位搜索、反馈提交或推荐公司等交互能力。",
      "我们仅在反滥用、限流和运维所必需的范围内记录请求元数据。",
      "如涉及跨境数据流转、用工合规或个人信息处理，跨境合规事项仍需法律复核。"
    ].join("\n")
  },
  terms: {
    slug: "terms",
    title: "使用条款",
    body: [
      "本服务仅用于求职信息查询与纠错反馈，不构成对招聘信息真实性或适用性的担保。",
      "未经书面许可，禁止抓取、批量复制、转售或商业化复用本服务数据。",
      "触发异常流量、自动化批量访问或规避风控的请求可能被限流或 challenge。"
    ].join("\n")
  }
};

export function getStaticDocument(slug: "privacy" | "terms"): StaticDocument {
  return DOCUMENTS[slug];
}
