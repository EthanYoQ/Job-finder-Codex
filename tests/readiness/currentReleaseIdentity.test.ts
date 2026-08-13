import {execFileSync,spawnSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {afterEach,describe,expect,it} from "vitest";
import * as currentReleaseIdentity from "../../src/readiness/currentReleaseIdentity";
import {assertCurrentReleaseRosterHash,loadCurrentReleaseIdentity} from "../../src/readiness/currentReleaseIdentity";
import {confirmedCompanyRosterV3} from "../../src/data/confirmedCompanyRosterV3";
import {createBuildIdentity} from "../../src/readiness/buildIdentity";
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(x=>rmSync(x,{recursive:true,force:true})));
function tree(){const root=mkdtempSync(join(tmpdir(),"build-id-"));dirs.push(root);for(const dir of ["src","scripts","prisma","ops","dist","node_modules"])mkdirSync(join(root,dir));for(const file of ["package.json","package-lock.json","tsconfig.json","Dockerfile",".dockerignore","index.html","vite.config.ts"])writeFileSync(join(root,file),"{}\n");writeFileSync(join(root,"src","main.ts"),"export {};\n");writeFileSync(join(root,"dist","app.js"),"built\n");writeFileSync(join(root,"node_modules","dependency.js"),"dependency\n");return root;}
function child(root:string){const url=pathToFileURL(resolve("src/readiness/buildIdentity.ts")).href,loader=pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;return spawnSync(process.execPath,["--import",loader,"--eval",`import('${url}').then(m=>console.log(JSON.stringify(m.resolveCurrentBuildIdentity()))).catch(e=>{console.error(e.message);process.exit(9)})`],{cwd:root,encoding:"utf8"});}
describe("current release identity",()=>{
  it("uses the user-authorized 30-hour publication freshness window",()=>{
    expect((currentReleaseIdentity as Record<string, unknown>).CURRENT_RELEASE_FRESHNESS_MAXIMUM_MS)
      .toBe(30 * 60 * 60 * 1_000);
  });
  it("rejects membership or oracle roster hashes different from confirmed V3",()=>{
    expect(()=>assertCurrentReleaseRosterHash("0".repeat(64),confirmedCompanyRosterV3.membersSha256)).toThrow(/roster/i);
    expect(()=>assertCurrentReleaseRosterHash(confirmedCompanyRosterV3.membersSha256,"0".repeat(64))).toThrow(/roster/i);
    expect(()=>assertCurrentReleaseRosterHash(confirmedCompanyRosterV3.membersSha256,confirmedCompanyRosterV3.membersSha256)).not.toThrow();
  });
  it("exposes a zero-argument production loader",()=>{expect(loadCurrentReleaseIdentity.length).toBe(0);});
  it("rejects dirty and accepts clean real Git trees",()=>{const root=tree();execFileSync("git",["init"],{cwd:root});execFileSync("git",["config","user.email","test@example.com"],{cwd:root});execFileSync("git",["config","user.name","test"],{cwd:root});execFileSync("git",["add","."],{cwd:root});execFileSync("git",["commit","-m","base"],{cwd:root});expect(child(root).status).toBe(0);writeFileSync(join(root,"src","main.ts"),"dirty\n");expect(child(root).stderr).toMatch(/dirty/i);});
  it("accepts a valid baked runtime without the source-only lock and rejects runtime tampering",()=>{const root=tree(),commit="1".repeat(40),artifact=JSON.stringify(createBuildIdentity(root,commit));writeFileSync(join(root,"build-identity.json"),artifact);rmSync(join(root,"package-lock.json"));expect(child(root).status).toBe(0);writeFileSync(join(root,"dist","app.js"),"tamper\n");expect(child(root).stderr).toMatch(/binding|digest/i);writeFileSync(join(root,"dist","app.js"),"built\n");writeFileSync(join(root,"node_modules","dependency.js"),"tamper\n");expect(child(root).stderr).toMatch(/binding|digest/i);writeFileSync(join(root,"node_modules","dependency.js"),"dependency\n");rmSync(join(root,"ops"),{recursive:true});expect(child(root).stderr).toMatch(/missing/i);rmSync(join(root,"build-identity.json"));expect(child(root).stderr).toMatch(/absent|invalid/i);});
  it("keeps Docker runtime copied roots equal to attested runtime roots",()=>{const docker=readFileSync("Dockerfile","utf8");for(const root of ["dist","src","scripts","prisma","ops","node_modules"])expect(docker).toMatch(new RegExp(`COPY[^\\n]+/${root}[^\\n]+\\./${root}`));});
  it("keeps attested Vite build inputs available for baked runtime identity verification",()=>{const docker=readFileSync("Dockerfile","utf8");for(const file of ["index.html","vite.config.ts"])expect(docker).toContain(`COPY --chown=node:node --from=identity /app/${file} /app/${file}`);});
  it("rejects an out-of-root symlink",()=>{const root=tree(),outside=join(root,"..",`outside-${Date.now()}.txt`);writeFileSync(outside,"outside");try{symlinkSync(outside,join(root,"src","escape.ts"));expect(()=>createBuildIdentity(root,"1".repeat(40))).toThrow(/escapes/i);}finally{rmSync(outside,{force:true});}});
  it("rejects a directory symlink loop",()=>{const root=tree();symlinkSync(join(root,"src"),join(root,"src","loop"),process.platform==="win32"?"junction":"dir");expect(()=>createBuildIdentity(root,"1".repeat(40))).toThrow(/directory symlink|loop/i);});
  it("hashes a contained file symlink as link metadata",()=>{const root=tree();symlinkSync(join(root,"src","main.ts"),join(root,"scripts","main-link.ts"),"file");expect(createBuildIdentity(root,"1".repeat(40)).runtimeTreeSha256).toMatch(/^[a-f0-9]{64}$/);});
  it("binds bytes of a contained file-link target outside attested roots",()=>{const root=tree(),target=join(root,"unattested-target.js"),link=join(root,"node_modules",".bin-like");writeFileSync(target,"one");symlinkSync(target,link,"file");const before=createBuildIdentity(root,"1".repeat(40)).runtimeTreeSha256;writeFileSync(target,"two");expect(createBuildIdentity(root,"1".repeat(40)).runtimeTreeSha256).not.toBe(before);});
});
