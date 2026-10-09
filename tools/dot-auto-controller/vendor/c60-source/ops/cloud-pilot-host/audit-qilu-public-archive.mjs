import { createHash } from 'node:crypto';
import {createRequire} from 'node:module';
const {load:loadHtml}=createRequire('/workspace/shared/job-finder-recovery/candidate-investigation/cloud-qilu-sql45-pilot/package.json')('cheerio');

// Pure, local-only privacy/scope preflight. Does not replace existing archive,
// owned-acquisition, request-contract, completeness, or admission verification.
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const HEX = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const fail = code => { throw Error(`QILU_PUBLIC_ARCHIVE_AUDIT:${code}`); };
const requireThat = (condition, code) => { if (!condition) fail(code); };
const keys = (value, required, optional = []) => {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'OBJECT_REQUIRED');
  requireThat(required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => [...required, ...optional].includes(k)), 'UNKNOWN_OR_MISSING_FIELD');
};
const integer = (n, min = 0, max = 1500) => Number.isSafeInteger(n) && n >= min && n <= max;
const stamp = value => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value));
const hash = value => typeof value === 'string' && HEX.test(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canonicalJsonBody = bytes => {
  const text = bytes.toString('utf8');
  requireThat(Buffer.from(text, 'utf8').equals(bytes), 'UTF8_REQUIRED');
  let value; try { value = JSON.parse(text); } catch { fail('JSON_REQUIRED'); }
  // Reject duplicate keys, trailing payload, alternative escapes, or unreviewed
  // serialization. The retained Beisen and generated metadata bodies pass this.
  requireThat(JSON.stringify(value) === text, 'UNREVIEWED_JSON_SERIALIZATION');
  return value;
};
const scanPublicString = (value, approvedPublicTextSha256 = []) => {
  requireThat(typeof value === 'string' && value.length <= 10000, 'STRING_LIMIT');
  const decoded = value.replace(/&#(?:x([a-f0-9]+)|(\d+));?/gi, (_, hex, dec) => {
    const n = parseInt(hex || dec, hex ? 16 : 10); return n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/&(?:commat|period|colon|sol|bsol|quot|apos|lt|gt|amp);/gi, m => ({'&commat;':'@','&period;':'.','&colon;':':','&sol;':'/','&bsol;':'\\','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&amp;':'&'}[m.toLowerCase()]));
  requireThat(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded), 'CONTROL_CHARACTER');
  requireThat(!/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[\w.-]+|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?(?:id|token)|csrf|authorization|set-cookie)\b)/i.test(decoded), 'CREDENTIAL_OR_SESSION_MARKER');
  requireThat(!/(?:[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)0\d{2,3}[-－— ]?\d{7,8}(?!\d)|(?<!\d)\d{6}(?:19|20)\d{10}[\dXx](?!\d)|(?:applicant|passport|resume)\s*[:=])/i.test(decoded), 'UNREVIEWED_PERSONAL_OR_CONTACT_DATA');
  requireThat(!/姓名|身份证|手机号码|联系人|联系电话|出生日期|个人信息/.test(decoded) || approvedPublicTextSha256.includes(sha256(value)), 'UNREVIEWED_PERSONAL_DATA_TERMINOLOGY');
  requireThat(!/[<>]/.test(decoded), 'UNREVIEWED_BODY_MARKUP');
};

// Public unauthenticated HTML is not frozen to a previous page fingerprint.
// The body SHA remains byte-bound in every artifact and replay; this check only
// prevents credential/personalized payload leakage before private retention.
export function auditPublicHtml(bytes, sourceTitle = '齐鲁') {
  const text=bytes.toString('utf8');
  requireThat(Buffer.from(text,'utf8').equals(bytes),'UTF8_REQUIRED');
  const $=loadHtml(text);
  requireThat($('title').text().trim() && (sourceTitle === null || $('title').text().includes(sourceTitle)),'HTML_SOURCE_TITLE');
  const protectedName=name=>/^(?:accesstoken|refreshtoken|authtoken|authorization|apikey|clientsecret|consumersecret|secret|password|passwd|session|sessionid|sessiontoken|csrftoken|xsrf|xsrftoken|cookie|setcookie|username|(?:user|currentuser|loggedinuser|profile)(?:id|info|data|profile|record|records)?|applicant\w*|candidate\w*|resume(?:url|data)?|idcard|passport|personaldata)$/.test(name.toLowerCase().replace(/[-_\s]/g,''));
  $('*').each((_i,element)=>{
    for(const [name,value] of Object.entries(element.attribs??{})){
      if(value.trim()&&protectedName(name.replace(/^data-/i,'')))fail('HTML_SENSITIVE_DATA');
      if(/^(?:href|src|action)$/i.test(name)){let url;try{url=new URL(value,'https://www.qilu-pharma.com/');}catch{continue;}if(url.username||url.password||[...url.searchParams].some(([key,v])=>v&&protectedName(key)))fail('HTML_SENSITIVE_DATA');}
    }
  });
  $('input,textarea,select,meta').each((_i,element)=>{
    const el=$(element),value=el.attr('value')??el.attr('content')??el.val()??el.text();
    if(String(value??'').trim()&&[el.attr('name'),el.attr('property'),el.attr('id'),el.attr('autocomplete'),el.attr('http-equiv'),el.attr('type')].some(x=>x&&(protectedName(x)||/^(?:first.?name|last.?name|full.?name|email|phone|mobile|telephone|date.?of.?birth|birth.?date|ssn|bank.?account|credit.?card)$/i.test(x))))fail('HTML_SENSITIVE_DATA');
  });
  let decoded=$('body').text()+'\n'+$('script').map((_i,e)=>$(e).html()??'').get().join('\n')+'\n'+text;
  for(let i=0;i<2;i++)decoded=decoded.replace(/\\u([a-f\d]{4})|\\x([a-f\d]{2})/gi,(_m,a,b)=>String.fromCharCode(parseInt(a??b,16)));
  requireThat(!/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[\w.-]+|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b)/i.test(decoded),'HTML_SENSITIVE_DATA');
  const assignments=/(?:["']?)([A-Za-z_$][A-Za-z\d_$-]*)(?:["']?\s*\]?)\s*(?::(?!:)|=(?!=|>))\s*/g;
  for(const m of decoded.matchAll(assignments)){
    if(protectedName(m[1])&&!/^(?:null|false|undefined|""|''|\{\s*\}|\[\s*\])\s*(?=[;,}\]\r\n]|$)/.test(decoded.slice(m.index+m[0].length)))fail('HTML_SENSITIVE_DATA');
  }
  for(const m of decoded.matchAll(/[?&]([A-Za-z][\w-]*)=([^&#\s"'<>]+)/g))if(protectedName(m[1])&&m[2])fail('HTML_SENSITIVE_DATA');
}

export const METADATA_FIELDS = Object.freeze({
  root: ['schemaVersion','partitions'],
  partition: ['channelId','evidence'],
  evidence: ['captureTool','artifacts','pages','declaredCompleteness','fetchCounts','fetchLosses'],
  artifact: ['id','logicalKey','kind','requestedUrl','finalUrl','httpStatus','contentType','capturedAt','bodyRepresentation','extractorLocator','bodySha256'],
  page: ['sequence','artifactLogicalKey','requestedCursor','returnedCursor','requestedOffset','returnedOffset','requestedPage','returnedPage','requestedPageSize','returnedPageSize','rawJobIds','validJobIds','declaredTotal','declaredCount','declaredPages','nextPageSignalBefore','nextPageSignalAfter','responseFingerprintSha256','termination','anomalyCodes','capturedAt'],
  declaration: ['kind','value','artifactLogicalKey','extractorLocator','scope'],
  counts: ['rawCount','parsedCount','validCount','parseDiscardCount','validationDiscardCount'],
  loss: ['stage','reason','rawLocator','details'],
  lossDetails: ['code','pageSequence','recordIndex']
});
const JSON_LOCATOR = /^beisen-zhiye-page-v1\|requestPageIndex:\d{1,2}\|requestPageSize:15\|requestCategory:sha256:391552c099c101b131feaf24c5795a6a15bc8ec82015424e0d2b4274a369a0bf\|json:\$\.Count,\$\.Data\|request-contract-v2\|sha256:[a-f0-9]{64}$/;
const HTML_LOCATOR = '.e_loop-65 .cbox-65.p_loopitem|request-contract-v2|sha256:fb523e7376fed934209089c1f1539843601ad1ba9b4b90a30f53dc29617f9451';
const DECLARATION_LOCATOR = 'qilu-marketing-and-nonmarketing-complete-traversal-v1';
const META_LOCATOR = 'retained-original-partition-declarations-and-traces';
const innerKey = (marketing, index) => marketing ? 'official-html-page-0000' : `beisen-page-${String(index).padStart(4,'0')}`;

function validateRows(root, rule) {
  keys(root, ['Code','Count','Data','Message','MoreMessage','ReturnUrl','TipType','Total']);
  requireThat(root.Code === 200 && root.Message === 'operation success' && root.MoreMessage === '' && root.ReturnUrl === null && root.TipType === 'Success' && root.Total === 0, 'JSON_ENVELOPE');
  requireThat(integer(root.Count,1) && Array.isArray(root.Data) && root.Data.length > 0 && root.Data.length <= 15, 'JSON_PAGE_BOUND');
  for (const row of root.Data) {
    keys(row, Object.keys(rule.rowFields));
    for (const [name,type] of Object.entries(rule.rowFields)) {
      const v = row[name];
      requireThat(type === 'null' ? v === null : type === 'integer' ? integer(v,0,Number.MAX_SAFE_INTEGER) : type === 'string[]' ? Array.isArray(v) && v.length > 0 && v.length <= 20 && v.every(s => typeof s === 'string') : typeof v === type, 'ROW_FIELD_TYPE');
      if (Object.hasOwn(rule.rowConstants,name)) requireThat(equal(v,rule.rowConstants[name]), 'UNREVIEWED_ROW_DEFAULT');
      if (typeof v === 'string' && !['Id','PostDate','ChangeDate','EndTime'].includes(name)) scanPublicString(v,name==='Duty'?rule.approvedPublicDutyTermSha256:[]);
      if (Array.isArray(v)) v.forEach(s=>scanPublicString(s));
    }
    requireThat(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.Id), 'VACANCY_UUID');
    for (const key of ['PostDate','ChangeDate','EndTime']) requireThat(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?$/.test(row[key]), 'PUBLIC_DATE_SHAPE');
  }
}

function validateMetadata(root, artifacts, bodyRecords, rule) {
  keys(root,METADATA_FIELDS.root);
  requireThat(root.schemaVersion === 'qilu-main-partition-metadata-v1' && Array.isArray(root.partitions) && root.partitions.length === 2, 'METADATA_ROOT');
  for (const [partitionIndex,part] of root.partitions.entries()) {
    keys(part,METADATA_FIELDS.partition);
    const marketing = partitionIndex === 0, channel = marketing ? 'qilu-marketing' : 'qilu-non-marketing';
    requireThat(part.channelId === channel,'PARTITION_ORDER');
    const e=part.evidence; keys(e,METADATA_FIELDS.evidence); keys(e.captureTool,['name','version']);
    requireThat(e.captureTool.name === (marketing ? 'official-html-http' : 'official-json-http') && e.captureTool.version === '1','CAPTURE_TOOL');
    requireThat(Array.isArray(e.artifacts) && Array.isArray(e.pages) && e.artifacts.length === e.pages.length && e.pages.length >= 1 && e.pages.length <= (marketing?1:100),'PARTITION_PAGE_COUNT');
    let rawRows=0;
    for (const [index,a] of e.artifacts.entries()) {
      keys(a,METADATA_FIELDS.artifact);
      const key=innerKey(marketing,index), outer=artifacts.get(channel+'-'+key);
      requireThat(outer && a.id===key && a.logicalKey===key && a.kind==='PAGINATION_PAGE' && a.requestedUrl===(marketing?rule.marketingUrl:rule.jsonUrl) && a.finalUrl===a.requestedUrl && a.httpStatus===200 && a.bodyRepresentation==='EXACT' && stamp(a.capturedAt) && a.bodySha256===outer.sha256,'INNER_ARTIFACT_BINDING');
      requireThat(a.contentType===(marketing?'text/html; charset=utf-8':'application/json; charset=utf-8') && a.extractorLocator===outer.extractorLocator && a.capturedAt===outer.capturedAt,'INNER_ARTIFACT_METADATA');
      const page=e.pages[index]; keys(page,METADATA_FIELDS.page);
      requireThat(page.sequence===index && page.artifactLogicalKey===key && page.capturedAt===a.capturedAt && page.responseFingerprintSha256===a.bodySha256,'PAGE_BINDING');
      for (const name of ['requestedCursor','returnedCursor','requestedOffset','returnedOffset','returnedPage','returnedPageSize','declaredCount','declaredPages']) requireThat(page[name]===null,'UNREVIEWED_PAGE_COORDINATE');
      requireThat(page.requestedPage===(marketing?null:index) && page.requestedPageSize===(marketing?null:15),'REQUEST_COORDINATE');
      for (const name of ['rawJobIds','validJobIds']) requireThat(Array.isArray(page[name]) && page[name].length<=15 && page[name].every(s => typeof s==='string' && (marketing?/^html-row:sha256:[a-f0-9]{64}$/:/^sha256:[a-f0-9]{64}$/).test(s)),'ROW_ID_TRACE');
      requireThat(Array.isArray(page.anomalyCodes) && page.anomalyCodes.length===0,'PAGE_ANOMALY');
      requireThat(page.termination===(index===e.pages.length-1?'NEXT_ABSENT':'CONTINUE') && page.nextPageSignalBefore===(marketing?'initial':index===0?null:`page:${index}`) && page.nextPageSignalAfter===(index===e.pages.length-1?null:`page:${index+1}`),'PAGE_TERMINATION');
      const body=bodyRecords.get(channel+'-'+key);
      requireThat(page.declaredTotal===(marketing?null:body.Count) && page.rawJobIds.length===(marketing?1:body.Data.length),'ROW_COUNT_BINDING');
      rawRows+=page.rawJobIds.length;
    }
    keys(e.declaredCompleteness,METADATA_FIELDS.declaration);
    requireThat(e.declaredCompleteness.kind==='COMPLETE_PAGE_TRAVERSAL' && e.declaredCompleteness.scope==='SOURCE' && e.declaredCompleteness.value===e.pages.length && e.declaredCompleteness.artifactLogicalKey===innerKey(marketing,0) && e.declaredCompleteness.extractorLocator===e.artifacts[0].extractorLocator,'DECLARATION');
    keys(e.fetchCounts,METADATA_FIELDS.counts);
    requireThat(Object.values(e.fetchCounts).every(v=>integer(v)) && e.fetchCounts.rawCount===rawRows && e.fetchCounts.parsedCount===rawRows && e.fetchCounts.parseDiscardCount===0,'COUNT_SHAPE');
    requireThat(Array.isArray(e.fetchLosses) && e.fetchLosses.length<=rawRows,'LOSS_LIMIT');
    for (const loss of e.fetchLosses) {
      keys(loss,METADATA_FIELDS.loss);keys(loss.details,METADATA_FIELDS.lossDetails);
      requireThat(!marketing && loss.stage==='VALIDATION' && loss.reason==='Beisen Zhiye record rejected: OUT_OF_SCOPE' && loss.details.code==='OUT_OF_SCOPE' && integer(loss.details.pageSequence,0,e.pages.length-1) && integer(loss.details.recordIndex,0,14) && /^beisen-page-\d{4}#record:\d{1,2}#sha256:[a-f0-9]{64}$/.test(loss.rawLocator),'LOSS_SHAPE');
    }
    requireThat(e.fetchCounts.validationDiscardCount===e.fetchLosses.length && e.fetchCounts.validCount===rawRows-e.fetchLosses.length,'LOSS_COUNTS');
  }
}

export function auditQiluPublicArchive(bundle, { expected, sourceConfigSha256, rule }) {
  requireThat(rule.version==='qilu-public-archive-audit-v2' && sourceConfigSha256===rule.sourceConfigSha256 && expected.sourceId===rule.sourceId && rule.sourceId==='source-qilu-social','SOURCE_CONFIG_BINDING');
  keys(bundle,['schemaVersion','sidecar','files']); requireThat(bundle.schemaVersion===1,'BUNDLE_VERSION');
  const s=bundle.sidecar;keys(s,['releaseCandidateId','batchId','sourceId','sourceResultId','evidenceSubdirectory','artifacts']);
  for(const key of ['releaseCandidateId','batchId','sourceId','sourceResultId']) requireThat(s[key]===expected[key] && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(s[key]),'EXPECTED_TUPLE');
  requireThat(['private/runtime-evidence','cloud-pilot/runtime-evidence'].includes(expected.evidenceSubdirectory) && s.evidenceSubdirectory===expected.evidenceSubdirectory,'EVIDENCE_DIRECTORY');
  requireThat(Array.isArray(s.artifacts) && Array.isArray(bundle.files) && s.artifacts.length===bundle.files.length && bundle.files.length>=4 && bundle.files.length<=103,'ARTIFACT_SET_SIZE');
  const artifacts=new Map(),bodyRecords=new Map(),byPath=new Map();let totalBytes=0,jsonPages=0,jsonRows=0;
  for(const a of s.artifacts) {
    keys(a,['id','logicalKey','releaseCandidateId','batchId','sourceId','sourceResultId','kind','capturedAt','sha256','byteCount','path','extractorLocator','captureToolName','captureToolVersion'],['channelId','requestedUrl','finalUrl','httpStatus','contentType','bodyRepresentation']);
    for(const key of ['releaseCandidateId','batchId','sourceId','sourceResultId']) requireThat(a[key]===s[key],'ARTIFACT_TUPLE');
    requireThat(stamp(a.capturedAt) && hash(a.sha256) && integer(a.byteCount,1,1024*1024) && a.captureToolName==='qilu-required-partition-http' && a.captureToolVersion==='1','ARTIFACT_ENVELOPE');
    const id=sha256(JSON.stringify(['runtime-evidence-artifact-v1',s.releaseCandidateId,s.batchId,s.sourceId,s.sourceResultId,a.logicalKey]));
    requireThat(a.id===id && !artifacts.has(a.logicalKey) && !byPath.has(a.path),'ARTIFACT_IDENTITY');
    const isJson=/^qilu-non-marketing-beisen-page-\d{4}$/.test(a.logicalKey), isHtml=['qilu-marketing-official-html-page-0000','qilu-required-partitions-declaration'].includes(a.logicalKey),isMeta=a.logicalKey==='qilu-partition-metadata';
    requireThat(isJson||isHtml||isMeta,'UNREVIEWED_ARTIFACT');
    const path=`outputs/p0-rc/${s.releaseCandidateId}/${s.evidenceSubdirectory}/artifacts/${s.batchId}/${s.sourceId}/${s.sourceResultId}/${id}--${a.logicalKey}.${isJson?'json':isHtml?'html':'bin'}`;
    requireThat(a.path===path,'ARTIFACT_PATH');
    if(isMeta) requireThat(a.kind==='COMMAND_OUTPUT' && a.extractorLocator===META_LOCATOR && ['channelId','requestedUrl','finalUrl','httpStatus','contentType','bodyRepresentation'].every(k=>!Object.hasOwn(a,k)),'METADATA_ARTIFACT');
    else {
      requireThat(a.requestedUrl===(isJson?rule.jsonUrl:rule.marketingUrl) && a.finalUrl===a.requestedUrl && a.httpStatus===200 && a.bodyRepresentation==='EXACT' && a.contentType===(isJson?'application/json; charset=utf-8':'text/html; charset=utf-8'),'PUBLIC_RESPONSE_ENVELOPE');
      requireThat(a.kind===(a.logicalKey==='qilu-required-partitions-declaration'?'OFFICIAL_COMPANY_PAGE':'PAGINATION_PAGE') && (isJson?a.channelId==='qilu-non-marketing':a.logicalKey.startsWith('qilu-marketing')?a.channelId==='qilu-marketing':!Object.hasOwn(a,'channelId')),'CHANNEL_AND_KIND');
      requireThat(isJson?JSON_LOCATOR.test(a.extractorLocator):a.extractorLocator===(a.logicalKey==='qilu-required-partitions-declaration'?DECLARATION_LOCATOR:HTML_LOCATOR),'EXTRACTOR_LOCATOR');
    }
    artifacts.set(a.logicalKey,a);byPath.set(a.path,a);
  }
  const seen=new Set();
  for(const file of bundle.files) {
    keys(file,['path','sha256','byteCount','chunks']);const a=byPath.get(file.path);
    requireThat(a && !seen.has(file.path) && file.sha256===a.sha256 && file.byteCount===a.byteCount,'FILE_SET_BINDING');seen.add(file.path);
    requireThat(Array.isArray(file.chunks) && file.chunks.length===Math.ceil(file.byteCount/576),'CHUNK_COUNT');
    const bytes=Buffer.concat(file.chunks.map((c,i)=>{requireThat(typeof c==='string' && c.length<=768,'CHUNK_LIMIT');const b=Buffer.from(c,'base64');requireThat(b.toString('base64')===c && (i===file.chunks.length-1||b.length===576),'BASE64_CANONICAL');return b;}));
    requireThat(bytes.length===file.byteCount && sha256(bytes)===file.sha256,'BODY_BYTES');totalBytes+=bytes.length;requireThat(totalBytes<=8*1024*1024,'ARCHIVE_BYTE_LIMIT');
    if(a.logicalKey.endsWith('declaration') || a.logicalKey==='qilu-marketing-official-html-page-0000') auditPublicHtml(bytes);
    else {const parsed=canonicalJsonBody(bytes);bodyRecords.set(a.logicalKey,parsed);if(a.logicalKey!=='qilu-partition-metadata'){validateRows(parsed,rule);jsonPages++;jsonRows+=parsed.Data.length;}}
  }
  requireThat(artifacts.size===jsonPages+3 && artifacts.has('qilu-marketing-official-html-page-0000') && artifacts.has('qilu-required-partitions-declaration') && artifacts.has('qilu-partition-metadata'),'REQUIRED_ARTIFACT_SET');
  validateMetadata(bodyRecords.get('qilu-partition-metadata'),artifacts,bodyRecords,rule);
  requireThat(jsonRows===bodyRecords.get('qilu-non-marketing-beisen-page-0000')?.Count,'COMPLETE_JSON_COUNT');
  return Object.freeze({status:'PASS',ruleVersion:rule.version,artifactCount:artifacts.size,bodyBytes:totalBytes,jsonPages,jsonRows,htmlPrivacyScreened:true,originalBodyHashesRetained:true});
}
