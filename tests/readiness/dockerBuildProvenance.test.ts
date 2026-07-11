import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {canonicalSourceTreeSha256} from "../../src/readiness/buildIdentity";
import {exportDockerBuildProvenance,verifyDockerBuildProvenance} from "../../src/readiness/dockerBuildProvenance";

const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(path=>rmSync(path,{recursive:true,force:true})));
function repository(){
  const root=mkdtempSync(join(tmpdir(),"docker-provenance-repo-"));dirs.push(root);
  for(const dir of ["src","scripts","prisma","ops","dist","node_modules"])mkdirSync(join(root,dir));
  for(const file of ["package.json","package-lock.json","tsconfig.json","Dockerfile",".dockerignore"])writeFileSync(join(root,file),"{}\n");
  writeFileSync(join(root,"src","main.ts"),"export {};\n");for(const dir of ["scripts","prisma","ops"])writeFileSync(join(root,dir,"keep"),"tracked\n");writeFileSync(join(root,"dist","app.js"),"built\n");writeFileSync(join(root,"node_modules","dependency.js"),"dependency\n");
  execFileSync("git",["init"],{cwd:root});execFileSync("git",["config","user.email","test@example.com"],{cwd:root});execFileSync("git",["config","user.name","test"],{cwd:root});execFileSync("git",["add","."],{cwd:root});execFileSync("git",["commit","-m","base"],{cwd:root});
  return root;
}
describe("portable Docker build provenance",()=>{
  it("excludes Git internals from the Docker context while retaining portable provenance",()=>{
    const ignored=readFileSync(".dockerignore","utf8").split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
    expect(ignored).toContain(".git");
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
});
