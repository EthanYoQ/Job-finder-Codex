# Pfizer TRUE_B 新采集输入合同

本文件是原生采集与本地验证的静态输入合同，不授予HTTP、浏览器、数据库、登记、激活或发布权限。采集输入必须是经另行授权的新原件。

## 固定来源和路线

- producer commit：`28402a299bb04cbf5873da66c2fe8ca76827c0d1`
- source：`source-pfizer-china-social`；company：`company-pfizer-china`
- sourceConfigSha256：`84aaab8bad3579630eec1b12d3f09236755b3a25d0b7751ca8584a9a53a83413`
- source entry：`https://pfizer.wd1.myworkdayjobs.com/PfizerCareers`
- official chain：`https://www.pfizer.com/about/careers/search-results`
- 原路线：TRUE_B。原生证书：`b-grade-independent-traversal-v2`
- 主路：`HTTP_WORKDAY_COUNTRY_LIST_PLUS_NATIVE_DETAILS`
- 独立路：`PLAYWRIGHT_OFFICIAL_UI_JSONLD_TRAVERSAL`，实现 `pfizer-official-dom-jsonld-traversal-v1`
- Pfizer没有Servier的“DOM名单+独立HTTP详情”混合输入。Pfizer独立路需要真实浏览器名单、原生详情DOM及JSON-LD。把主HTTP详情当成独立证据会改变原路线。

## 未绑定源码的入口合同

`hosts/pfizer/supervision/start-monitor-pfizer51-combined.js` 是正式入口骨架。源码模板的candidate/database均为null；本包不包含actual activation/control/context。

将来由owner完成绑定后，loader先将下列会话输入清空：

- `proxyNode22:pfizer:currentIndependentValidationInput`
- `proxyNode22:pfizer:currentCaptureInput`
- `proxyNode22:pfizer:currentRetainedCaptureInput`
- `proxyNode22:pfizer:nextBatchId`

本host只接收新 independentValidation 描述符：`{path: <绝对路径>, sha256: <原文件bytes的64位小写SHA256>}`。key只能是path和sha256。入口先执行本地 `runtime/verify-independent-validation.mts`，成功后才读取新候选/到期上下文。该入口将 independentValidation 放入新bootstrap；不放currentCapture或retainedCapture。主HTTP由原 `scripts/p0-cloud-source-pilot.ts` 在本次启动采集。

正式监督命令保持Node22.23.3、`--max-old-space-size=384`、HTTP 45秒、总监督1800000ms、原source-pilot及 `--db-started-control`。`preflight-launch.mjs check` 是辅助检查，报告明确 `launchPermitted:false`、`supervisedStarterRequired:true`；`launch`直启明确拒绝。

## 浏览器原包

真实浏览器打开：
`https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country=6cb77610a8a543aea2d6bc10457e35d4`

包形状：

```
{
  "captureKind": "MANAGED_BROWSER_DOM_JSONLD",
  "observedAt": "<采集开始时原始ISO UTC时间>",
  "packets": [
    {
      "listPage": {
        "url": "<上面的精确URL>",
        "title": "Search for Jobs",
        "countryFilter": "China clear filter",
        "filterCount": 1,
        "searchText": "",
        "pageLabel": "Page <1-based page> of <total pages>",
        "range": "<start> - <end> of <raw total> jobs",
        "totalText": "<raw total> JOBS FOUND",
        "nextControlPresent": "<真实boolean；仅最后页false>",
        "capturedAt": "<该页原始时间>"
      },
      "rows": [
        {
          "capturedAt": "<该详情原始ISO UTC时间>",
          "officialId": "<7位官方ID>",
          "externalPath": "/job/<原生路径>_<官方ID><可选-数字suffix>",
          "title": "<名单标题>",
          "detailUrl": "<en-US/PfizerCareers + externalPath + 同一Location_Country参数>",
          "renderedTitle": "<详情DOM标题>",
          "renderedId": "<详情DOM requisition ID>",
          "renderedLocations": ["<全部原始地点，非空且无重复>"],
          "applyEnabled": true,
          "jsonLd": "<唯一JobPosting script的原始JSON字符串>",
          "documentTitle": "<浏览器document.title>"
        }
      ]
    }
  ]
}
```

这是格式说明，尖括号和字符串boolean不可用作证据。可保留完整DOM、详情正文等附加原字段；脚本先验证原件后投影，投影绑定原整包/原行/原列表页SHA。应保留完整原包。不要从主爬结果、HTTP JSON或旧包填造DOM字段。

浏览器要求：名单和详情导航HTTP 200、最终URL精确；只有China过滤器且搜索为空。每页20条，最后页余数；1至20页。页号连续、总数稳定、声明页数=ceil(raw total/20)。next可用性与是否末页严格一致。原生详情恰好一个JSON-LD script；岗位可申请。

详情的officialId、路径suffix、renderedId及JSON-LD identifier.value一致；标题只允许实现中的空白/HTML实体规范化差异。JSON-LD必须为JobPosting，datePosted为YYYY-MM-DD，jobLocation.address为对象。重复JSON key拒绝。

大陆收入：JSON-LD country=China、locality以CHN/China加空格连字符开头，至少一个rendered location为大陆China/CHN且不含Hong Kong/Taiwan/Macau/Macao。

唯一允许的审计排除：JSON-LD country=India、locality以IND -开头、第一DOM地点India -；所有地点是India -英文地点或APAC/Europe/IDM - Any Pfizer Site三个允许值。未知/矛盾国家拒绝整个输入，不可静默排除。

## DOM转验证文件

采集脚本的接口合同：

`<pinned-node> --import <producer>/node_modules/tsx/dist/loader.mjs <producer>/scripts/capture-pfizer-b-source.ts dom <新的private-output-dir> <actual-managed-browser-capture.json>`

输出目录必须不存在。脚本创建0700目录，输出0600且wx禁止覆盖：

- plan.json
- managed-browser-capture.json：复制原始bytes
- independent-validation.json：schema `official-json-browser-network-traversal-v1`
- capture-summary.json：非签证候选摘要

选择新 `independent-validation.json` 的绝对真实路径及原bytes SHA256传给host。host CLI拒绝相对路径和路径祖先symlink。摘要不能代替validation文件，也不能代替原包。

## 主HTTP合同和可选capture格式

当前host在source-pilot内fresh采集。主Workday POST endpoint：
`https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs`

精确body：`{"appliedFacets":{"Location_Country":["6cb77610a8a543aea2d6bc10457e35d4"]},"limit":20,"offset":<0,20,...>,"searchText":""}`。

每行必须有非空title、一个7位bulletFields ID、对应原生externalPath。对每个名单ID，包括最终排除的India岗位，GET同API前缀+externalPath。详情要求jobReqId/title/site/externalUrl一致、posted/canApply为true、正文去标签后至少100字符，地点非空无重复，startDate有效。大陆country与jobRequisitionLocation.country必须分别为官方China ID/CN。India排除必须为官方India ID/IN及已审计地点集合。

必须请求超末页terminal。它要么空页，要么短尾页后与第一页完全相同的reset；不得把页上限当终点。主路最多20个列表页。单响应≤2,000,000 bytes；主详情/列表累计≤35,000,000 bytes。请求/响应保留原EXACT body、URL、状态、contentType、capturedAt、request locator。后续页total=0仅在原精确闭合策略下接受，不能改总分母。

原脚本 `capture-pfizer-b-source.ts main <new-private-dir>` 可独立生成未签证候选，输出response-0000.json等原response、sourceFetchResult.v8、result.v8、records.json、plan.json、reviewed-worker-capture.json、capture-summary.json。它不是本host目前选择的输入路径，不应绕过starter自行接入。

若未来明确选择producer支持的currentCapture路径，manifest必须为schemaVersion=2，包含固定sourceId/config hash、原startedAt/finishedAt及fetched `{path,sha256,encoding:"v8"}`。manifest≤100,000 bytes，fetched≤64MiB，ok=true且含artifact。所有artifact及fetched.capturedAt位于manifest原时间区间，started≤finished≤now，读取时now-started严格<30分钟；同一读取只允许消费一次。不能改时间、复用旧包或当作B证书。

## 时间和集合闭合

- 原bootstrap.checkedAt：0至60秒。
- 独立observedAt≤now；每个原row/list capturedAt均在observedAt与now之间。
- B签证CURRENT_RUN观察距签证≤1小时；host输入/发布在1小时边界拒绝。
- expiresAt最多observedAt+7天，但Pfizer永远强制CURRENT_RUN；7天不是可复用窗口。
- 主原件首响应至terminal≤1小时，所有artifact介于首/末时间；签证now距首响应≤1小时。
- 真实publication截止取min(main source.startedAt+30min, independent.expiresAt, independent.observedAt+1h)，边界拒绝。outer delta不能丢掉inner B截止。
- 主与独立raw sourceJobId集合、raw官方证据ID集合、India排除集合、大陆最终集合逐一相等。
- 主/独立每个raw ID、sourceJobId均唯一；不允许任意dedupe削减。raw=parsed=included+India排除；valid=dedupe output=included；parse/normalization/dedupe discard为0。
- 每条排除必须有VALIDATION损失账，code `PFIZER_VERIFIED_INDIA_SCOPE`，原pageSequence/recordIndex/rawLocator与排除官方ID绑定。
- CURRENT生命周期member必须唯一且哈希等于最终canonical job set。

## Archive合同

所选DB-started路线要求保留完整owned archive，并从新的空目录恢复后验证。此source-only包不声明任何远端保留或恢复结果。ARCHIVE_STORE不是本包所选执行路线，入口对此请求明确拒绝。
