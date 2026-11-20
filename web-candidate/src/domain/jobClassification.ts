import type { JobCategory } from "./search";
import { findJobClassificationEvidence, resolveJobClassificationEvidence } from "./jobClassificationEvidence";

export const JOB_CATEGORY_GROUPS = {
  "销售": ["医药销售", "零售销售", "销售管理", "培训与赋能"],
  "市场": ["品牌市场", "市场洞察"],
  "商务": ["业务拓展", "商业运营"],
  "渠道": ["渠道管理"],
  "KA": ["大客户管理", "医院准入"],
  "医学事务": ["医学联络", "医学顾问", "医学写作", "医学信息", "医学策略与合作"],
  "临床运营": ["临床研究监察", "临床研究执行", "临床数据管理"],
  "注册": ["注册事务"],
  "药物警戒/安全": ["药物安全"],
  "研发/科学": ["药物发现", "临床药理", "临床科学", "生物统计", "质量研究", "转化医学", "研发科学"],
  "生产/工程": ["生产制造", "工程技术", "MSAT 技术转移"],
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
  officialUrl?: string;
}

type ClassificationRule = {
  [Category in JobCategory]: {
    category: Category;
    subcategory: (typeof JOB_CATEGORY_GROUPS)[Category][number];
    title: RegExp;
    excludes?: RegExp;
    sourceIds?: readonly string[];
  }
}[JobCategory];

const SALES_TITLE = /医药代表|医药销售|药品销售|临床销售|销售代表|医药信息(?:沟通)?(?:高级[/／]?|资深)?(?:专家|专员|代表|经理|主管|顾问)|医药专员|推广专员|\b(?:sales|medical represent(?:ative|ive)|(?:bio)?pharmaceutical rep(?:resentative)?|pharmaceutical info(?:rmation)? (?:specialist|manager|rep(?:resentative)?)|product representative)\b/i;
const COMMUNICATION_SALES_TITLE = /医学信息沟通(?:高级|资深)?(?:代表|专员|主管|经理)|\b(?:s?mics|medical information communication (?:representative|repres|specialist|manager))\b/i;
const COMMUNICATION_SALES_SOURCES = [
  "source-pfizer-china-social", "source-viatris-social", "source-shanghai-pharma-social",
  "source-sanofi-china-social", "source-bms-china-social"
];

const RULES: readonly ClassificationRule[] = [
  { category: "职能", subcategory: "人力资源", title: /\bsales recruit(?:er|ing|ment)\b/i },
  { category: "质量", subcategory: "临床质量", title: /临床质量|(?:中心|临床)稽查|\bclinical quality\b/i },
  { category: "供应链/采购", subcategory: "临床供应链", title: /临床供应|\bclinical (?:trials? )?suppl(?:y|ies)\b/i },
  { category: "研发/科学", subcategory: "临床药理", title: /临床药理|药代动力学|\bclinical pharmacolog\w*\b|\bpharmacokinetic\w*\b/i },
  { category: "研发/科学", subcategory: "生物统计", title: /临床统计|生物统计|统计编程|统计遗传|\b(?:clinical statistic\w*|biostatistic\w*|statistical (?:science|programming|genetics)|clinical biometrics|statistician)\b/i },
  { category: "研发/科学", subcategory: "质量研究", title: /质量研究/, excludes: /注册|\bregulatory\b/i },
  { category: "药物警戒/安全", subcategory: "药物安全", title: /安全医生|patientsafetyphysician|药物警戒|药物安全|患者安全|\bpv(?:\s*(?:physician|officer|manager|specialist|lead|director)\b|(?:医生|总监|主管|经理|专员|专家|负责人))|\b(?:pharmacovigilance|drug safety|patient\s*safety|safety physician|global\s+safety|china\s+safety\s+officer|safety\s+data\s+lead)\b/i },
  { category: "注册", subcategory: "注册事务", title: /注册|药政|\b(?:regulatory|racmc|rapv|ra (?:operations?|ta leader))\b/i },
  { category: "医学事务", subcategory: "医学联络", title: /医学(?:科学)?联络|\b(?:medical (?:science|scientific) liaison|msl)\b/i },
  { category: "医学事务", subcategory: "医学写作", title: /医学编辑|医学发表|医学写作|\bmedical writ(?:ing|er)\b/i },
  { category: "医学事务", subcategory: "医学策略与合作", title: /医学策略|\bmedical\b.*\bscientific strategy\b/i },
  { category: "医学事务", subcategory: "医学顾问", title: /区域医学|医学负责人|上市前医学|\bmedical (?:consultant|operation manager|science head)\b|医学顾问|医学科学顾问|医学(?:经理|总监)|医学事务|医学(?:项目|教育)(?:专员|主管|经理|总监)?|临床医学(?:经理|主管|副总裁|专家)|\bmedical (?:scientific |science )?(?:advis[oe]r|director|manager|affairs|education)\b/i },
  { category: "临床运营", subcategory: "临床研究监察", title: /临床(?:研究)?(?:监查|监察)|\b(?:clinical research associate|clinical monitor|cra)\b/i },
  { category: "临床运营", subcategory: "临床数据管理", title: /临床数据|\bclinical data\b/i },
  { category: "临床运营", subcategory: "临床研究执行", title: /\b(?:crc|study start up|global studies leader)\b|临床项目管理|临床项目(?:助理|副|高级)?(?:经理|主管|总监)|临床医学(?:高级|执行)?总监|\b(?:cta|ssu|clinical (?:manager|program lead))\b|临床(?:运营|试验|研究(?:项目|经理|助理|协调|负责人|主管|总监)|协调(?:专员|员)?)|\b(?:(?:country|global) study (?:lead|manager|management|delivery|coordinator)|study (?:manager|management|delivery|coordinator)|clinical (?:trial|operations|research (?:manager|management|coordinator|assistant))|china clinical lead)\b/i },
  { category: "研发/科学", subcategory: "临床科学", title: /临床(?:科学|开发)|\bclinical (?:scientist|science|development|research physician)\b/i },
  { category: "研发/科学", subcategory: "转化医学", title: /转化医学|转化科学|生物标志物|\btranslational (?:medicine|science|research|omics|lead)\b/i },
  { category: "研发/科学", subcategory: "药物发现", title: /药化|药效学|抗体发现|体内药效|体外生物学|药物发现|药物化学|药物筛选|\b(?:drug discovery|medicinal chemistry|cadd|aidd)\b/i },
  { category: "质量", subcategory: "质量保证", title: /质量运营|工艺验证|质量工程师|\bgmp\b|质量保证|质量保障|质量管理|质量体系|\b(?:qa|quality assurance|quality management|quality engineer|quality systems?|supplier quality|external quality)\b/i },
  { category: "质量", subcategory: "质量控制", title: /质量控制|质量检验|质量分析|\b(?:qc|quality control)\b/i },
  { category: "市场准入/政府事务", subcategory: "卫生经济与真实世界研究", title: /准入卫经|卫生经济|药物经济|真实世界|\b(?:heor|hta|health econom\w*|real[- ]world (?:evidence|research|data))\b/i },
  { category: "市场准入/政府事务", subcategory: "政府事务", title: /政府事务|政府关系|公共事务|\b(?:government|public) (?:affairs|relations|policy)\b/i },
  { category: "KA", subcategory: "医院准入", title: /医院准入|\bhospital access\b/i, excludes: /政策|政府|\bpolicy\b/i },
  { category: "市场准入/政府事务", subcategory: "准入与定价", title: /准入项目规划|\baccess excellence\b|市场准入|医保准入|准入策略|定价|(?:省区|区域|大区|全国)?准入(?:\([^)]+\))?(?:主管|经理|专员|总监)|\b(?:market access|pricing|reimbursement|pipeline access)\b/i },
  { category: "商务", subcategory: "业务拓展", title: /商业合作|商务经理|\bbd (?:manager|associate director)\b|商务拓展|业务拓展|业务发展|\b(?:business development|corporate development|search (?:and|&) evaluation|scouting (?:and|&) (?:partnering|transaction)|ecosystem partnership,? bd)\b/i },
  { category: "商务", subcategory: "商业运营", title: /销售支持|销售助理|业务运营|电商运营|\bsfe\b|商业运营|商务运营|销售运营|销售效能|\b(?:commercial|business|sales) (?:operations|excellence|effectiveness|strategy)\b/i },
  { category: "销售", subcategory: "零售销售", title: /零售(?:(?:关键|大)?客户|商务|销售|代表)|\bretail (?:key account|commercial|sales)\b/i },
  { category: "渠道", subcategory: "渠道管理", title: /渠道|分销|\b(?:channel|distribution) (?:manager|management|director|sales)\b/i },
  { category: "KA", subcategory: "大客户管理", title: /大客户|关键客户|客户(?:解决方案专员|专员|主任|经理)|\b(?:account executive|sae)\b|\b(?:key account|ka|kam)\b/i },
  { category: "销售", subcategory: "销售管理", title: /(?:区域|省区|合作)推广经理|\b(?:promotion manager|district hospital manager)\b|销售(?:经理|管理|总监|主管)|省区经理|大区经理|零售地区经理|地区经理|\b(?:(?:sr\.?|senior)\s+)?district\s+(?:manager|mgr)\b|\bsales (?:manager|director|head|lead)\b|\bregional sales manager\b/i },
  { category: "销售", subcategory: "培训与赋能", title: /销售培训|\bfield\s+force\s+training\b/i },
  { category: "销售", subcategory: "销售管理", title: /医学信息沟通(?:主管|经理)/u, sourceIds: ["source-pfizer-china-social"] },
  { category: "销售", subcategory: "医药销售", title: /治疗领域(?:专员|经理)/u, sourceIds: ["source-roche-china-social"] },
  { category: "销售", subcategory: "医药销售", title: /\bmcr\b/i, sourceIds: ["source-takeda-china-social"] },
  { category: "销售", subcategory: "销售管理", title: /^(?:\(s\)|s)?[rp]m\b/i, sourceIds: ["source-takeda-china-social"] },
  { category: "销售", subcategory: "医药销售", title: /\bmedical specialist\b/i, sourceIds: ["source-bayer-healthcare-social"] },
  { category: "销售", subcategory: "销售管理", title: /\basm\b/i, sourceIds: ["source-daiichi-sankyo-china-social"] },
  { category: "销售", subcategory: "销售管理", title: /\bdsm\b/i, sourceIds: ["source-astrazeneca-social"] },
  { category: "市场", subcategory: "品牌市场", title: /\bs?bm\b/i, sourceIds: ["source-astrazeneca-social"] },
  { category: "销售", subcategory: "医药销售", title: /^mr\b/i, sourceIds: ["source-astrazeneca-social"] },
  { category: "销售", subcategory: "销售管理", title: /\brsm\b/i, sourceIds: ["source-astrazeneca-social"] },
  { category: "销售", subcategory: "销售管理", title: /^regional manager\b/i, sourceIds: ["source-msd-china-social"] },
  { category: "销售", subcategory: "销售管理", title: /办事处经理|区域经理.*产品线/u, sourceIds: ["source-cttq-social"] },
  { category: "销售", subcategory: "医药销售", title: /宜科欣皮肤专员|区域产品专员|学术专员.*全域市场/u, sourceIds: ["source-cttq-social"] },
  { category: "销售", subcategory: "医药销售", title: SALES_TITLE },
  { category: "销售", subcategory: "医药销售", title: COMMUNICATION_SALES_TITLE, sourceIds: COMMUNICATION_SALES_SOURCES },
  { category: "销售", subcategory: "医药销售", title: /^Diagnosis Science Liaison(?:\s*[-–—]|$)/i, sourceIds: ["source-astrazeneca-social"] },
  { category: "销售", subcategory: "零售销售", title: /^零售\s*(?:\(高级\)\s*)?客户(?:代表|专员)|零售全国重点客户经理/, sourceIds: ["source-novartis-social"] },
  { category: "销售", subcategory: "医药销售", title: /产品专员/, sourceIds: ["source-novartis-social"] },
  { category: "医学事务", subcategory: "医学信息", title: /医学信息|医学沟通|科学传播|\b(?:medical information|medical communication|scientific communication)s?\b/i, excludes: /医学信息沟通|\bmedical information communication\b/i },
  { category: "市场", subcategory: "市场洞察", title: /竞争情报|商业预测|业务分析与洞察|\b(?:business analytics|competitive intelligence|country insights)\b|市场洞察|市场调研|商业洞察|产品洞察|\b(?:market|business|commercial|product) (?:insight|intelligence|research)\b/i },
  { category: "市场", subcategory: "品牌市场", title: /新产品规划|中央市场|品牌(?:策略|战略|传播|项目)|产品经理|\bproduct manager(?=_|\b)|\brpm\b|市场(?:经理|主管|总监|专员|营销|品牌)|品牌(?:经理|总监|管理)|数字营销|\bmarketing\b|\bbrand (?:manager|director|lead)\b/i },
  { category: "职能", subcategory: "人力资源", title: /人才(?:发展|经理)|人力资源|人事|招聘|薪酬|员工关系|\b(?:hr|hrbp|human resources|talent acquisition|recruiter|people (?:and|&) culture|learning (?:and|&) development)\b/i },
  { category: "职能", subcategory: "财务", title: /投资者关系|证券事务|投资(?:经理|助理|总监)|预算管理|财务|会计|财税|审计|核算|资金管理|\b(?:financ\w*|accounting|accountant|controller|tax|treasury|audit)\b/i },
  { category: "职能", subcategory: "法务合规", title: /律师|法务|合规|法律|专利(?:事务|保护|预警|流程|管理|经理|主管|专员|总监)|知识产权|\b(?:legal|compliance|counsel|patent)\b/i },
  { category: "职能", subcategory: "行政", title: /高管助理|负责人助理|行政|秘书|总裁助理|总经理助理|\b(?:executive assistant|administrative|office manager|facilities)\b/i },
  { category: "供应链/采购", subcategory: "采购", title: /采购|\b(?:procurement|purchasing|buyer|strategic sourcing|sourcing (?:manager|specialist|lead|director))\b/i },
  { category: "供应链/采购", subcategory: "供应链运营", title: /仓库|供应链|供应计划|需求计划|仓储|物流|\b(?:supply chain|supply (?:planner|planning)|demand (?:planner|planning)|logistics|warehouse)\b/i },
  { category: "数据/IT", subcategory: "数据科学", title: /数据管理|数据洞察|数据(?:科学|分析|治理|工程|智能)|统计师|\b(?:data (?:scien\w*|anal\w*|engineer\w*|governance|intelligence)|machine learning)\b/i },
  { category: "数据/IT", subcategory: "信息技术", title: /数字化项目|架构师|\b(?:itbp|low code|cloud enablement|technology strategy)\b|信息技术|信息系统|软件|人工智能|网络安全|(?:java|python|前端|后端|全栈|信息化)(?:全栈|前端|后端)?开发|全栈工程师|\b(?:cloud (?:delivery|operations?|platform|assurance)|data integration|enterprise engineering|ddit|cyber\s*&\s*infrastructure|digital (?:capability|and technology|customer platforms))\b|\bmes项目经理|\b(?:it|software|informatics|cybersecurity|digital project|application engineer|ai)\b/i },
  { category: "研发/科学", subcategory: "研发科学", title: /临床前|早期研究|早研|毒理|工艺开发|工艺分析|制剂研究|化学开发|细胞株(?:开发|构建)|培养基开发|药物分析|核酸化学|多肽(?:设计|分析)|体外筛选|晶型研究|制剂(?:工艺)?开发|\b(?:external innovation|cmc (?:portfolio|expert)|biomolecular technologies)\b|科学家|研究员|研发|药理|生物分析|\b(?:scientist|research (?:associate|scientist|director)|bioanalysis|pharmacology|protein science|r&d|cmc\s+lead)\b/i, excludes: /\bmedical scientist\b/i },
  { category: "生产/工程", subcategory: "MSAT 技术转移", title: /\bMSAT (?:Technology Transfer|技术转移)|MSAT技术转移/i, sourceIds: ["source-roche-china-social"] },
  { category: "生产/工程", subcategory: "生产制造", title: /^MSAT Manager in Plant$/i, sourceIds: ["source-roche-china-social"] },
  { category: "生产/工程", subcategory: "工程技术", title: /^Assc MSAT Manager\s*[-–—]\s*Validation Expert$/i, sourceIds: ["source-roche-china-social"] },
  { category: "生产/工程", subcategory: "生产制造", title: /(?:灌装|分装|包装|配液)(?:操作|工|负责人)|压片操作|副?厂长|\b(?:packaging operator|specialist - filling)\b|生产|制造|车间|\b(?:manufacturing|production|sterile (?:master )?operator)\b/i },
  { category: "生产/工程", subcategory: "工程技术", title: /公用工程|土建工程|自动化(?:工程|负责人|经理)|工程项目经理|工程师|设备|维修|设施|\b(?:engineer|engineering|maintenance|technician)\b/i }
];

export function classifyJob(job: ClassificationInput): JobClassification {
  const evidence = findJobClassificationEvidence(job);
  const verified = evidence && resolveJobClassificationEvidence(evidence);
  if (verified) return verified;
  const normalizedTitle = job.officialTitle.normalize("NFKC").replace(/\s+/g, " ").trim();
  const title = job.sourceId === "source-qilu-social"
    ? normalizedTitle.replace("(海内外招聘)", "")
    : normalizedTitle;
  if ((job.category === "其他" || job.category === "注册") &&
    /^注册安全工程师(?![\p{L}\p{N}])/u.test(title))
    return { category: "生产/工程", subcategory: "工程技术" };
  if (job.category === "其他" && job.sourceId === "source-hengrui-social" &&
    /生物统计与编程部\s*[-–—]\s*中央医学事务部$/.test(title)) return { category: "医学事务" };
  const rule = RULES.find((candidate) =>
    (job.category === "其他" || candidate.category === job.category) &&
    (!candidate.sourceIds || job.sourceId !== undefined && candidate.sourceIds.includes(job.sourceId)) &&
    candidate.title.test(title) &&
    (!candidate.excludes || !candidate.excludes.test(title))
  );
  return rule ? { category: rule.category, subcategory: rule.subcategory } : { category: job.category };
}

export function matchesJobCategory(job: { category: string; subcategory?: string }, categories: readonly string[]): boolean {
  return categories.length === 0 || categories.includes(job.category) ||
    job.subcategory !== undefined && categories.includes(job.subcategory);
}
