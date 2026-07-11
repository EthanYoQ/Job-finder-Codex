import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {canonicalSourceTreeSha256,createBuildIdentity,type BuildIdentityArtifact} from "./buildIdentity";

export const ATTESTED_GIT_PATHS=["src","scripts","prisma","ops","package.json","package-lock.json","tsconfig.json","Dockerfile",".dockerignore"] as const;

export function exportDockerBuildProvenance(root:string,bundlePath:string):void{
  const status=git(root,["status","--porcelain","--",...ATTESTED_GIT_PATHS]);
  if(status.trim())throw new Error("Docker build source provenance is dirty");
  git(root,["bundle","create",resolve(bundlePath),"HEAD"]);
}

export function verifyDockerBuildProvenance(root:string,bundlePath:string,commitSha:string,expectedTree:string):BuildIdentityArtifact{
  const checkout=mkdtempSync(join(tmpdir(),"job-finder-build-provenance-"));
  try{
    execFileSync("git",["clone","--quiet","--no-checkout",resolve(bundlePath),checkout],{stdio:["ignore","ignore","pipe"]});
    const bundledHead=git(checkout,["rev-parse","HEAD"]).trim();
    if(bundledHead!==commitSha)throw new Error("Docker build commit argument does not match portable Git provenance");
    git(checkout,["checkout","--quiet","--detach",commitSha]);
    const committedTree=canonicalSourceTreeSha256(checkout);
    const copiedTree=canonicalSourceTreeSha256(root);
    if(copiedTree!==committedTree||copiedTree!==expectedTree)throw new Error("Docker build actual source tree does not match committed clean source provenance");
    return createBuildIdentity(root,commitSha);
  }catch(error){
    if(error instanceof Error&&/Docker build/.test(error.message))throw error;
    throw new Error("Docker build requires resolvable portable Git provenance",{cause:error});
  }finally{rmSync(checkout,{recursive:true,force:true});}
}

function git(root:string,args:string[]):string{return execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]});}
