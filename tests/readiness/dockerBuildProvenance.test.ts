import {execFileSync} from "node:child_process";
import {lstatSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {canonicalSourceTreeSha256} from "../../src/readiness/buildIdentity";
import {applyModesWithRollback,closeAllHandles,exportDockerBuildProvenance,openVerifiedModeHandle,symlinkTargetMatchesCommitted,verifyDockerBuildProvenance} from "../../src/readiness/dockerBuildProvenance";

const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
function repository(){
  const root=mkdtempSync(join(tmpdir(),"docker-provenance-repo-"));dirs.push(root);
  for(const dir of ["src","scripts","prisma","ops","dist","node_modules"])mkdirSync(join(root,dir));
  for(const file of ["package.json","package-lock.json","tsconfig.json","Dockerfile",".dockerignore","vite.config.ts"])writeFileSync(join(root,file),"{}\n");
  writeFileSync(join(root,"index.html"),"<div id=\"root\"></div>\n");
  writeFileSync(join(root,"src","main.ts"),"export {};\n");for(const dir of ["scripts","prisma","ops"])writeFileSync(join(root,dir,"keep"),"tracked\n");writeFileSync(join(root,"dist","app.js"),"built\n");writeFileSync(join(root,"node_modules","dependency.js"),"dependency\n");
  execFileSync("git",["init"],{cwd:root});execFileSync("git",["config","user.email","test@example.com"],{cwd:root});execFileSync("git",["config","user.name","test"],{cwd:root});execFileSync("git",["add","."],{cwd:root});execFileSync("git",["commit","-m","base"],{cwd:root});
  return root;
}
describe("portable Docker build provenance",()=>{
  it("excludes Git internals from the Docker context while retaining portable provenance",()=>{
    const ignored=readFileSync(".dockerignore","utf8").split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
    expect(ignored).toContain(".git");
    expect(ignored).toContain("phase4-evidence");
    expect(ignored).not.toContain(".docker-build-provenance.bundle");
  });
  it("exports and verifies provenance from a linked worktree",()=>{
    const repo=repository(),worktree=join(tmpdir(),`docker-provenance-worktree-${Date.now()}`);dirs.push(worktree);
    execFileSync("git",["worktree","add","--detach",worktree,"HEAD"],{cwd:repo});
    for(const dir of ["dist","node_modules"])mkdirSync(join(worktree,dir),{recursive:true});writeFileSync(join(worktree,"dist","app.js"),"built\n");writeFileSync(join(worktree,"node_modules","dependency.js"),"dependency\n");
    const bundle=join(worktree,".docker-build-provenance.bundle");exportDockerBuildProvenance(worktree,bundle);
    const head=execFileSync("git",["rev-parse","HEAD"],{cwd:worktree,encoding:"utf8"}).trim();
    expect(verifyDockerBuildProvenance(worktree,bundle,head,canonicalSourceTreeSha256(worktree)).commitSha).toBe(head);
  });
  it("rejects copied source tampering, a forged commit argument, and dirty export",()=>{
    const root=repository(),bundle=join(root,".docker-build-provenance.bundle");exportDockerBuildProvenance(root,bundle);
    const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),digest=canonicalSourceTreeSha256(root);
    expect(verifyDockerBuildProvenance(root,bundle,head,digest).commitSha).toBe(head);
    expect(()=>verifyDockerBuildProvenance(root,bundle,"1".repeat(40),digest)).toThrow(/commit argument/i);
    writeFileSync(join(root,"src","main.ts"),"tampered\n");
    expect(()=>verifyDockerBuildProvenance(root,bundle,head,digest)).toThrow(/source tree/i);
    expect(()=>exportDockerBuildProvenance(root,bundle)).toThrow(/dirty/i);
  });
  it.each(["index.html","vite.config.ts"])("rejects dirty export when the Vite build input %s changes",file=>{
    const root=repository(),bundle=join(root,".docker-build-provenance.bundle");exportDockerBuildProvenance(root,bundle);
    writeFileSync(join(root,file),"tampered build input\n");
    expect(()=>exportDockerBuildProvenance(root,bundle)).toThrow(/dirty/i);
  });
  it.each(["index.html","vite.config.ts"])("rejects copied tampering of the Vite build input %s",file=>{
    const root=repository(),bundle=join(root,".docker-build-provenance.bundle");exportDockerBuildProvenance(root,bundle);
    const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
    writeFileSync(join(root,file),"tampered build input\n");
    expect(()=>verifyDockerBuildProvenance(root,bundle,head,canonicalSourceTreeSha256(root))).toThrow(/source tree/i);
  });
  it("copies only explicitly attested inputs into the Docker build stage",()=>{
    const dockerfile=readFileSync("Dockerfile","utf8");
    expect(dockerfile).not.toMatch(/^COPY\s+\.\s+\.$/mu);
    const allowed=["src","scripts","prisma","ops","package.json","package-lock.json","tsconfig.json","Dockerfile",".dockerignore","index.html","vite.config.ts",".docker-build-provenance.bundle"];
    for(const path of allowed){
      const escaped=path.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&");
      expect(dockerfile).toMatch(new RegExp(`^COPY\\s+${escaped}(?:\\s+|/\\s+)`,"mu"));
    }
    const hostCopySources=dockerfile.split(/\r?\n/u).filter(line=>/^COPY\s+(?!--from=)/u.test(line)).map(line=>/^COPY\s+(\S+)\s+\S+$/u.exec(line)?.[1]);
    expect(hostCopySources.every(source=>source!==undefined&&allowed.includes(source))).toBe(true);
  });
  it("accepts a Windows CRLF checkout of an LF Git blob without weakening copied-byte binding",()=>{
    const root=repository(),bundle=join(root,".docker-build-provenance.bundle");exportDockerBuildProvenance(root,bundle);
    const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
    writeFileSync(join(root,"src","main.ts"),"export {};\r\n");
    const copiedDigest=canonicalSourceTreeSha256(root);
    expect(()=>verifyDockerBuildProvenance(root,bundle,head,copiedDigest)).not.toThrow();
    expect(()=>verifyDockerBuildProvenance(root,bundle,head,"0".repeat(64))).toThrow(/source tree/i);
  });
  it("rejects untracked, ignored, and symlink substitutions in copied source",()=>{
    const root=repository(),bundle=join(root,".docker-build-provenance.bundle");exportDockerBuildProvenance(root,bundle);
    const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
    const rejected=()=>expect(()=>verifyDockerBuildProvenance(root,bundle,head,canonicalSourceTreeSha256(root))).toThrow(/source tree/i);
    writeFileSync(join(root,"src","untracked.ts"),"extra\n");rejected();rmSync(join(root,"src","untracked.ts"));
    writeFileSync(join(root,".git","info","exclude"),"src/ignored.cache\n");writeFileSync(join(root,"src","ignored.cache"),"ignored\n");rejected();rmSync(join(root,"src","ignored.cache"));
    rmSync(join(root,"src","main.ts"));symlinkSync(join(root,"scripts","keep"),join(root,"src","main.ts"),"file");rejected();
  });
  it("does not inherit or execute global attributes and filter drivers",()=>{
    const root=repository(),bundle=join(root,".docker-build-provenance.bundle"),global=join(root,"malicious.gitconfig"),attrs=join(root,"malicious.attributes"),marker=join(root,"filter-executed");
    writeFileSync(attrs,"*.ts filter=evil\n");
    execFileSync("git",["config","--file",global,"core.attributesFile",attrs]);
    execFileSync("git",["config","--file",global,"filter.evil.clean",`${process.execPath} -e \"require('fs').writeFileSync('${marker.replaceAll("\\","/")}','ran')\"`]);
    exportDockerBuildProvenance(root,bundle);const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),previous=process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL=global;try{expect(()=>verifyDockerBuildProvenance(root,bundle,head,canonicalSourceTreeSha256(root))).not.toThrow();expect(()=>readFileSync(marker)).toThrow();}finally{if(previous===undefined)delete process.env.GIT_CONFIG_GLOBAL;else process.env.GIT_CONFIG_GLOBAL=previous;}
  });
  it("rejects a committed executable-mode change when copied mode is non-executable",()=>{
    const root=repository();execFileSync("git",["update-index","--chmod=+x","src/main.ts"],{cwd:root});execFileSync("git",["commit","-m","mode"],{cwd:root});
    const bundle=join(root,".docker-build-provenance.bundle");exportDockerBuildProvenance(root,bundle);const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
    expect(()=>verifyDockerBuildProvenance(root,bundle,head,canonicalSourceTreeSha256(root))).toThrow(/source tree/i);
    if(process.platform!=="win32")expect(()=>verifyDockerBuildProvenance(root,bundle,head,canonicalSourceTreeSha256(root),true)).not.toThrow();
  });
  it("hard-codes bundle-authoritative Docker COPY mode normalization in the image build",()=>{expect(readFileSync("scripts/generate-build-identity.ts","utf8")).toMatch(/verifyDockerBuildProvenance\([^;]+,true\)/u);});
  it("does not mutate any mode when full-tree content preflight fails",()=>{
    const root=repository();execFileSync("git",["update-index","--chmod=+x","src/main.ts"],{cwd:root});execFileSync("git",["commit","-m","mode"],{cwd:root});const bundle=join(root,".docker-build-provenance.bundle");exportDockerBuildProvenance(root,bundle);
    const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),before=lstatSync(join(root,"src","main.ts")).mode;writeFileSync(join(root,"ops","keep"),"tampered\n");
    expect(()=>verifyDockerBuildProvenance(root,bundle,head,canonicalSourceTreeSha256(root),true)).toThrow(/content/i);expect(lstatSync(join(root,"src","main.ts")).mode).toBe(before);
  });
  it("treats symlink target newline bytes as exact path data",()=>{
    expect(symlinkTargetMatchesCommitted("target\n",Buffer.from("target\n"))).toBe(true);
    expect(symlinkTargetMatchesCommitted("target\r\n",Buffer.from("target\n"))).toBe(false);
  });
  it("rolls back fd modes on the primary fchmod failure",()=>{
    const file=(path:string)=>({path,absolute:path,mode:"100644" as const,dev:1,ino:1}),handles=[{fd:1,file:file("one"),originalMode:0o600},{fd:2,file:file("two"),originalMode:0o640}],calls:string[]=[],primary=new Error("primary chmod");
    expect(()=>applyModesWithRollback(handles,(fd,mode)=>{calls.push(`${fd}:${mode.toString(8)}`);if(fd===2&&mode===0o644)throw primary;})).toThrow(primary);
    expect(calls).toEqual(["1:644","2:644","1:600","2:640"]);
  });
  it("attempts every fd close and returns the first close error",()=>{
    const calls:number[]=[],first=new Error("first close");expect(closeAllHandles([{fd:1},{fd:2},{fd:3}],fd=>{calls.push(fd);if(fd===1)throw first;if(fd===2)throw new Error("second close");})).toBe(first);expect(calls).toEqual([1,2,3]);
  });
  it("closes a newly opened fd when fstat fails before handle registration",()=>{
    const primary=new Error("fstat failed"),closed:number[]=[];
    expect(()=>openVerifiedModeHandle({path:"safe",absolute:"safe",mode:"100644",dev:1,ino:1},()=>41,()=>{throw primary;},fd=>closed.push(fd))).toThrow(primary);
    expect(closed).toEqual([41]);
  });
});
