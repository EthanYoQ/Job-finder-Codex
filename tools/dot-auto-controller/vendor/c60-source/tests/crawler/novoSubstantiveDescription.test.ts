import { describe, expect, it } from "vitest";
import { novoNativeApplicationUrl, novoNativeDetailHasSubstantiveDescription } from "../../src/crawler/novoChinaQuality";

// Entirely synthetic DOM. Historical HTTP originals are external test inputs,
// not embedded or silently rewritten to make this regression pass.
const jobId = "123456.en_GB";
const detailUrl = `https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.${jobId}.html`;
const apply = "https://career2.successfactors.eu/career?career_ns=job_listing&company=novonordisk&navBarLevel=JOB_SEARCH&rcm_site_locale=en_GB&career_job_req_id=123456&selected_lang=en_GB";
const eeo = "We commit to an inclusive recruitment process and equality of opportunity for all our job applicants.";
const english = "Design and execute pharmacology studies, analyse experimental results and document findings to support drug discovery programmes.";
const chinese = "负责设计并执行药理研究，分析实验数据并记录研究结果，与团队合作支持药物研发项目。";
const column = (body: string) => `<div class="job-display-details right-column">${body}</div>`;
const page = (body: string) => `<div id="careerjobdisplay"><h1>Synthetic Research Role</h1><div class="job-display-info left-column"><p>Beijing, China</p><p>Research</p><a href="${apply}">Apply now</a></div>${body}</div>`;

describe("Novo substantive native description", () => {
  it.each([
    ["asterisk and EEO", `<p>*</p><p>${eeo}</p>`],
    ["repeated EEO", `<p>${eeo}</p>`.repeat(12)],
    ["empty", ""],
    ["punctuation only", `<p>${"* — · ! ".repeat(100)}</p>`],
    ["TBD", "<p>TBD: the duties and qualifications will be completed by the hiring manager in a future revision.</p>"],
    ["template guidance", "<p>Please enter responsibilities and describe the skills and professional experience needed for this position.</p>"],
    ["inline template guidance", "<p>You will [insert the primary responsibilities and main objectives for this role here].</p>"],
    ["inline qualification placeholder", "<p>Experience in [insert required field] and qualifications appropriate for this position will be specified later.</p>"],
    ["Chinese template guidance", "<p>请填写岗位职责，描述负责的主要工作任务以及任职资格和相关工作经验。</p>"],
    ["headings only", `<h2>Key responsibilities</h2><p><strong>Qualifications 任职资格 Main Job Tasks 主要工作任务 Education Background 教育背景</strong></p>`],
    ["long heading only", `<h2>${english.repeat(8)}</h2>`],
    ["buttons only", `<div class="job-display-details-buttons">${english.repeat(8)}</div>`],
    ["links and controls only", `<a>${english}</a><button>${chinese}</button><form>${english}</form>`],
    ["script and template only", `<script>${english}</script><style>${english}</style><template><p>${english}</p></template><noscript>${chinese}</noscript>`],
    ["hidden content", `<div hidden><p>${english}</p></div><p aria-hidden="true">${chinese}</p>`],
    ["inline hidden content", `<p style="display: none !important">${english}</p><p style="visibility:hidden">${chinese}</p><p style="opacity:0">${english}</p>`],
    ["company boilerplate", "<p>At Novo Nordisk, we support your growth and develop opportunities for our people across the world.</p>"],
    ["career invitation boilerplate", "<p>Develop your career with us and explore exciting opportunities across our global organisation.</p>"],
    ["benefits invitation only", "<p>You will join an inspiring global team and enjoy competitive benefits and flexible working arrangements.</p>"],
    ["inline TBD qualification", "<p>PhD in TBD</p>"],
    ["plain heading labels only", "<p>This role Key Responsibilities Qualifications Professional Experience Main Job Tasks Education Background</p>"],
    ["duty-shaped label list", "<p>Design Development Leadership Management Responsibilities Qualifications Education Experience</p>"],
    ["Chinese career invitation", "<p>发挥您的工作经验并与我们共同发展职业生涯，探索更多精彩机会，共创美好未来。</p>"],
    ["Chinese company boilerplate", "<p>在诺和诺德，您的技能与工作经验帮助我们为患者创造更好的未来，我们支持每个人的发展。</p>"],
    ["long unrelated prose", "<p>A warm welcome to our website and to the many wonderful people who visit this page every day.</p>"],
    ["repeated heading keywords", `<p>${"responsible for ".repeat(100)}</p>`]
  ])("rejects %s despite valid title and native apply identity", (_name, body) => {
    expect(novoNativeDetailHasSubstantiveDescription(page(column(body)))).toBe(false);
    expect(novoNativeApplicationUrl(page(column(body)), detailUrl, jobId)).toBe(apply);
  });

  it("rejects title/location/apply padding outside the actual right column", () => {
    const html = page(column(`<p>*</p><p>${eeo}</p>`)).replace("Synthetic Research Role", english.repeat(40))
      .replace("Beijing, China", chinese.repeat(40)).replace("Apply now", english.repeat(40));
    expect(html.length).toBeGreaterThan(10000);
    expect(novoNativeDetailHasSubstantiveDescription(html)).toBe(false);
  });

  it.each([
    ["missing selector", `<div>${english}</div>`],
    ["duplicate columns", column(`<p>${english}</p>`).repeat(2)],
    ["hidden column", column(`<p>${english}</p>`).replace('right-column"', 'right-column" hidden')]
  ])("rejects %s", (_name, body) => expect(novoNativeDetailHasSubstantiveDescription(page(body))).toBe(false));
  it("rejects duplicate roots and hidden ancestors", () => {
    const html = page(column(`<p>${english}</p>`));
    expect(novoNativeDetailHasSubstantiveDescription(html.repeat(2))).toBe(false);
    expect(novoNativeDetailHasSubstantiveDescription(`<div style="display:none">${html}</div>`)).toBe(false);
  });

  it.each([
    ["English duties", `<p>${english}</p>`],
    ["subject-led duties", `<p>You will ${english.charAt(0).toLowerCase() + english.slice(1)}</p>`],
    ["role-led duties", "<p>This role involves designing and executing pharmacology studies to support the drug discovery programmes.</p>"],
    ["bold duties without terminal punctuation", `<p><strong>${english.replace(/\.$/u, "")}</strong></p>`],
    ["Chinese duties", `<p>${chinese}</p>`],
    ["bilingual duties", `<p>${english}</p><p>${chinese}</p>`],
    ["qualification narrative", "<p>A bachelor's degree in pharmacology and relevant professional experience in experimental design are required.</p>"],
    ["short English qualification", "<p><strong>PhD in pharmacology</strong></p>"],
    ["short Chinese qualification", "<li><strong>药学本科及以上学历</strong></li>"],
    ["no fixed heading", `<h2>How you will contribute</h2><ul><li>${english}</li></ul>`],
    ["direct narrative", english],
    ["direct narrative before a footer", `${english}<div>Contact</div>`],
    ["narrative with boilerplate", `<p>${eeo}</p><p>${english}</p><div class="job-display-details-buttons">Print job</div>`]
  ])("preserves substantive %s", (_name, body) => {
    expect(novoNativeDetailHasSubstantiveDescription(page(column(body)))).toBe(true);
    expect(novoNativeApplicationUrl(page(column(body)), detailUrl, jobId)).toBe(apply);
  });
  it("does not relax native requisition or tenant identity", () => {
    const html = page(column(`<p>${english}</p>`));
    expect(novoNativeApplicationUrl(html, detailUrl, "654321.en_GB")).toBeUndefined();
    expect(novoNativeApplicationUrl(html.replace("company=novonordisk", "company=other"), detailUrl, jobId)).toBeUndefined();
  });
});
