import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const marketingUrl="https://www.qilu-pharma.com/JobPosting_list.html";
const apiUrl="https://qilu-pharma.zhiye.com/api/Jobad/GetJobAdPageList";
const syntheticMarketing=`<a href="https://qilu-pharma.zhiye.com/social">社会招聘（非营销类）</a><div class="e_loop-65"><div class="cbox-65 p_loopitem"><div class="e_text-83"><a href="/JobPosting_Detail/c-_detailId%3D12345.html">Synthetic marketing role</a></div><div class="e_text-86">山东省</div></div></div><div class="p_page"><a class="page_next disabled">下一页</a></div>`;
const syntheticPage=JSON.stringify({Code:200,Count:2,Data:[
  {Id:"abcdef00-0000-4000-8000-000000000001",JobAdId:1,JobAdName:"Synthetic non-marketing role",CategoryId:"1",Category:"社会招聘",Status:1,LocNames:["山东省·济南市"]},
  {Id:"00000000-0000-4000-8000-000000000002",JobAdId:2,JobAdName:"Synthetic foreign role",CategoryId:"1",Category:"社会招聘",Status:1,LocNames:["美国"]}
]});

/** Mock only raw HTTP. Owned acquisition, parsing, archive and admission stay real.
 * The optional directory is the existing private 2026-10-02 archive, never a URL.
 * Archived receipts/metadata cannot supply new owned authority.
 */
export async function qiluPilotHttpFixture(retainedRoot?:string){
  let marketing=syntheticMarketing,pages=[syntheticPage];
  if(retainedRoot){
    const names=await readdir(retainedRoot);
    const hashes:Record<string,string>=JSON.parse(await readFile("tests/fixtures/cloud-pilot/qilu-retained-body-manifest.json","utf8"));
    const read=async(suffix:string)=>{
      const matching=names.filter(name=>name.endsWith("--"+suffix));
      if(matching.length!==1)throw Error("QILU_RETAINED_RESPONSE_MISSING_OR_AMBIGUOUS");
      const name=matching[0]!,bytes=await readFile(join(retainedRoot,name));
      if(createHash("sha256").update(bytes).digest("hex")!==hashes[suffix])throw Error("QILU_RETAINED_RESPONSE_HASH_MISMATCH");
      return bytes.toString("utf8");
    };
    marketing=await read("qilu-marketing-official-html-page-0000.html");
    pages=await Promise.all(Array.from({length:16},(_,index)=>read(`qilu-non-marketing-beisen-page-${String(index).padStart(4,"0")}.json`)));
  }
  return {jobCount:retainedRoot?227:2,rawCount:retainedRoot?230:3,requestCount:1+pages.length,
    responseBytes:Buffer.byteLength(marketing)+pages.reduce((total,page)=>total+Buffer.byteLength(page),0),
    fetch:async(url:string,init?:RequestInit)=>{
      let body:string,contentType:string;
      if(url===marketingUrl&&(!init?.method||init.method==="GET")){body=marketing;contentType="text/html";}
      else if(url===apiUrl&&init?.method==="POST"){
        const request=JSON.parse(String(init.body));
        if(!Number.isInteger(request.PageIndex)||request.PageSize!==15||JSON.stringify(request.Category)!=='["1"]'||!pages[request.PageIndex])throw Error("QILU_UNEXPECTED_OFFLINE_PAGE_REQUEST");
        body=pages[request.PageIndex]!;contentType="application/json";
      }else throw Error("QILU_UNEXPECTED_OFFLINE_HTTP_REQUEST");
      return {status:200,url,headers:new Headers({"content-type":contentType}),text:async()=>body};
    }
  };
}
