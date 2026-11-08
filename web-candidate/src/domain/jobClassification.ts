import type { JobCategory } from "./search";

export const JOB_CATEGORY_GROUPS = {
  "销售": ["肿瘤销售", "罕见病销售", "基层医疗销售", "医药销售", "销售管理"],
  "市场": ["品牌市场", "市场洞察"],
  "商务": ["业务拓展", "商业运营"],
  "渠道": ["渠道管理"],
  "KA": ["大客户管理"],
  "医学事务": ["医学联络", "医学顾问", "医学写作", "医学信息", "医学策略与合作"],
  "临床运营": ["临床研究监察", "临床研究执行", "临床数据管理"],
  "注册": ["注册事务"],
  "药物警戒/安全": ["药物安全"],
  "研发/科学": ["药物发现", "临床药理", "临床科学", "转化医学", "研发科学"],
  "生产/工程": ["生产制造", "工程技术"],
  "质量": ["质量保证", "质量控制", "临床质量"],
  "市场准入/政府事务": ["准入与定价", "卫生经济与真实世界研究", "政府事务"],
  "数据/IT": ["数据科学", "信息技术"],
  "供应链/采购": ["临床供应链", "供应链运营", "采购"],
  "职能": ["人力资源", "财务", "法务合规", "行政"],
  "其他": []
} as const satisfies Record<JobCategory, readonly string[]>;

export type JobSubcategory = (typeof JOB_CATEGORY_GROUPS)[JobCategory][number];
export const JOB_SUBCATEGORIES = Object.values(JOB_CATEGORY_GROUPS).flat();

export interface JobClassification {
  category: JobCategory;
  subcategory?: JobSubcategory;
}

interface ClassificationInput {
  officialTitle: string;
  category: JobCategory;
  sourceId?: string;
}

type ClassificationRule = {
  [Category in JobCategory]: {
    category: Category;
    subcategory: (typeof JOB_CATEGORY_GROUPS)[Category][number];
    title: RegExp;
    requires?: RegExp;
    excludes?: RegExp;
    sourceIds?: readonly string[];
  }
}[JobCategory];

const SALES_TITLE = /医药代表|药品销售|临床销售|销售代表|\b(?:sales|medical represent(?:ative|ive)|(?:bio)?pharmaceutical rep(?:resentative)?|product representative)\b/i;
const COMMUNICATION_SALES_TITLE = /医学信息沟通(?:代表|专员)|\bmedical information communication (?:representative|repres|specialist)\b/i;
const COMMUNICATION_SALES_SOURCES = ["source-sanofi-china-social", "source-pfizer-china-social"];

const RULES: readonly ClassificationRule[] = [
  { category: "职能", subcategory: "人力资源", title: /\bsales recruit(?:er|ing|ment)\b/i },
  { category: "质量", subcategory: "临床质量", title: /临床质量|\bclinical quality\b/i },
  { category: "供应链/采购", subcategory: "临床供应链", title: /临床供应|\bclinical (?:trials? )?suppl(?:y|ies)\b/i },
  { category: "研发/科学", subcategory: "临床药理", title: /临床药理|药代动力学|\bclinical pharmacolog\w*\b|\bpharmacokinetic\w*\b/i },
  { category: "药物警戒/安全", subcategory: "药物安全", title: /药物警戒|药物安全|患者安全|\b(?:pharmacovigilance|drug safety|patient\s*safety|safety physician)\b/i },
  { category: "注册", subcategory: "注册事务", title: /注册|药政|\bregulatory\b/i },
  { category: "医学事务", subcategory: "医学联络", title: /医学(?:科学)?联络|\b(?:medical (?:science|scientific) liaison|msl)\b/i },
  { category: "医学事务", subcategory: "医学写作", title: /医学写作|\bmedical writ(?:ing|er)\b/i },
  { category: "医学事务", subcategory: "医学策略与合作", title: /医学策略|\bmedical\b.*\bscientific strategy\b/i },
  { category: "医学事务", subcategory: "医学顾问", title: /医学顾问|医学科学顾问|医学(?:经理|总监)|医学事务|\bmedical (?:scientific )?(?:advis[oe]r|director|manager|affairs)\b/i },
  { category: "临床运营", subcategory: "临床研究监察", title: /临床(?:研究)?(?:监查|监察)|\b(?:clinical research associate|clinical monitor|cra)\b/i },
  { category: "临床运营", subcategory: "临床数据管理", title: /临床数据|\bclinical data\b/i },
  { category: "临床运营", subcategory: "临床研究执行", title: /临床(?:运营|试验|研究(?:项目|经理|助理|协调))|\b(?:country study|study (?:manager|management|delivery|coordinator)|clinical (?:trial|operations|research (?:manager|coordinator|assistant)))\b/i },
  { category: "研发/科学", subcategory: "临床科学", title: /临床(?:科学|开发)|\bclinical (?:scientist|science|development|research physician)\b/i },
  { category: "研发/科学", subcategory: "转化医学", title: /转化医学|转化科学|\btranslational (?:medicine|science|research)\b/i },
  { category: "研发/科学", subcategory: "药物发现", title: /药物发现|药物化学|药物筛选|\b(?:drug discovery|medicinal chemistry|cadd|aidd)\b/i },
  { category: "质量", subcategory: "质量保证", title: /质量保证|质量保障|质量管理|质量体系|\b(?:qa|quality assurance|quality management|quality engineer|quality systems?|supplier quality)\b/i },
  { category: "质量", subcategory: "质量控制", title: /质量控制|质量检验|质量分析|\b(?:qc|quality control)\b/i },
  { category: "市场准入/政府事务", subcategory: "卫生经济与真实世界研究", title: /卫生经济|药物经济|真实世界|\b(?:heor|hta|health econom\w*|real[- ]world (?:evidence|research|data))\b/i },
  { category: "市场准入/政府事务", subcategory: "政府事务", title: /政府事务|政府关系|公共事务|\b(?:government|public) (?:affairs|relations|policy)\b/i },
  { category: "市场准入/政府事务", subcategory: "准入与定价", title: /市场准入|医保准入|准入策略|定价|\b(?:market access|pricing|reimbursement|pipeline access)\b/i },
  { category: "商务", subcategory: "业务拓展", title: /商务拓展|业务拓展|业务发展|\b(?:business development|corporate development|search (?:and|&) evaluation|scouting (?:and|&) (?:partnering|transaction)|ecosystem partnership,? bd)\b/i },
  { category: "商务", subcategory: "商业运营", title: /商业运营|商务运营|销售运营|销售效能|\b(?:commercial|business|sales) (?:operations|excellence|effectiveness|strategy)\b/i },
  { category: "渠道", subcategory: "渠道管理", title: /渠道|分销|\b(?:channel|distribution) (?:manager|management|director|sales)\b/i },
  { category: "KA", subcategory: "大客户管理", title: /大客户|\b(?:key account|ka|kam)\b/i },
  { category: "销售", subcategory: "肿瘤销售", title: /肿瘤|肺癌|乳腺癌|\b(?:oncology|onco|tumou?r)\b/i, requires: SALES_TITLE },
  { category: "销售", subcategory: "罕见病销售", title: /罕见病|\brare disease\b/i, requires: SALES_TITLE },
  { category: "销售", subcategory: "基层医疗销售", title: /基层医疗|基层|\bprimary care\b/i, requires: SALES_TITLE },
  { category: "销售", subcategory: "肿瘤销售", title: /肿瘤|肺癌|乳腺癌|\b(?:oncology|onco|tumou?r)\b/i, requires: COMMUNICATION_SALES_TITLE, sourceIds: COMMUNICATION_SALES_SOURCES },
  { category: "销售", subcategory: "罕见病销售", title: /罕见病|\brare disease\b/i, requires: COMMUNICATION_SALES_TITLE, sourceIds: COMMUNICATION_SALES_SOURCES },
  { category: "销售", subcategory: "基层医疗销售", title: /基层医疗|基层|\bprimary care\b/i, requires: COMMUNICATION_SALES_TITLE, sourceIds: COMMUNICATION_SALES_SOURCES },
  { category: "销售", subcategory: "销售管理", title: /销售(?:经理|管理|总监|主管)|\bsales (?:manager|director|head|lead)\b/i },
  { category: "销售", subcategory: "销售管理", title: /地区经理|\bdistrict manager\b/i, sourceIds: ["source-sanofi-china-social", "source-novartis-social"] },
  { category: "销售", subcategory: "医药销售", title: SALES_TITLE },
  { category: "销售", subcategory: "医药销售", title: COMMUNICATION_SALES_TITLE, sourceIds: COMMUNICATION_SALES_SOURCES },
  { category: "销售", subcategory: "医药销售", title: /产品专员/, sourceIds: ["source-novartis-social"] },
  { category: "医学事务", subcategory: "医学信息", title: /医学信息|医学沟通|科学传播|\b(?:medical information|medical communication|scientific communication)s?\b/i, excludes: /医学信息沟通|\bmedical information communication\b/i },
  { category: "市场", subcategory: "市场洞察", title: /市场洞察|市场调研|商业洞察|产品洞察|\b(?:market|business|commercial|product) (?:insight|intelligence|research)\b/i },
  { category: "市场", subcategory: "品牌市场", title: /市场(?:经理|主管|总监|营销|品牌)|品牌(?:经理|总监|管理)|数字营销|\bmarketing\b|\bbrand (?:manager|director|lead)\b/i },
  { category: "职能", subcategory: "人力资源", title: /人力资源|人事|招聘|薪酬|员工关系|\b(?:hr|hrbp|human resources|talent acquisition|recruiter|people (?:and|&) culture|learning (?:and|&) development)\b/i },
  { category: "职能", subcategory: "财务", title: /财务|会计|财税|审计|核算|资金管理|\b(?:financ\w*|accounting|accountant|controller|tax|treasury|audit)\b/i },
  { category: "职能", subcategory: "法务合规", title: /法务|合规|法律|\b(?:legal|compliance|counsel)\b/i },
  { category: "职能", subcategory: "行政", title: /行政|秘书|总裁助理|总经理助理|\b(?:executive assistant|administrative|office manager|facilities)\b/i },
  { category: "供应链/采购", subcategory: "采购", title: /采购|\b(?:procurement|purchasing|buyer|strategic sourcing)\b/i },
  { category: "供应链/采购", subcategory: "供应链运营", title: /供应链|供应计划|需求计划|仓储|物流|\b(?:supply chain|supply (?:planner|planning)|demand (?:planner|planning)|logistics|warehouse)\b/i },
  { category: "数据/IT", subcategory: "数据科学", title: /数据(?:科学|分析|治理|工程|智能)|生物统计|统计(?:编程|师)|\b(?:data (?:scien\w*|anal\w*|engineer\w*|governance|intelligence)|statistic\w*|biostatistic\w*|statistical programming|machine learning)\b/i },
  { category: "数据/IT", subcategory: "信息技术", title: /信息技术|信息系统|软件|人工智能|\b(?:it|software|informatics|cybersecurity|digital project|application engineer|ai)\b/i },
  { category: "研发/科学", subcategory: "研发科学", title: /科学家|研究员|研发|药理|生物分析|\b(?:scientist|research (?:associate|scientist|director)|bioanalysis|pharmacology|protein science|r&d)\b/i, excludes: /\bmedical scientist\b/i },
  { category: "生产/工程", subcategory: "生产制造", title: /生产|制造|车间|\b(?:manufacturing|production|sterile (?:master )?operator)\b/i },
  { category: "生产/工程", subcategory: "工程技术", title: /工程师|设备|维修|设施|\b(?:engineer|engineering|maintenance|technician)\b/i }
];

export function classifyJob(job: ClassificationInput): JobClassification {
  const title = job.officialTitle.normalize("NFKC").replace(/\s+/g, " ").trim();
  const rule = RULES.find((candidate) =>
    (job.category === "其他" || candidate.category === job.category) &&
    (!candidate.sourceIds || job.sourceId !== undefined && candidate.sourceIds.includes(job.sourceId)) &&
    candidate.title.test(title) && (!candidate.requires || candidate.requires.test(title)) &&
    (!candidate.excludes || !candidate.excludes.test(title))
  );
  return rule ? { category: rule.category, subcategory: rule.subcategory } : { category: job.category };
}

export function matchesJobCategory(job: { category: string; subcategory?: string }, categories: readonly string[]): boolean {
  return categories.length === 0 || categories.includes(job.category) ||
    job.subcategory !== undefined && categories.includes(job.subcategory);
}
