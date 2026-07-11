import {execFileSync} from "node:child_process";
import {lstatSync,mkdtempSync,readdirSync,readFileSync,readlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,relative,resolve} from "node:path";
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
    execFileSync("git",["clone","--quiet","--no-checkout",resolve(bundlePath),checkout],{stdio:["ignore","ignore","pipe"],env:isolatedGitEnvironment()});
    const bundledHead=git(checkout,["rev-parse","HEAD"]).trim();
    if(bundledHead!==commitSha)throw new Error("Docker build commit argument does not match portable Git provenance");
    const copiedTree=canonicalSourceTreeSha256(root);
    if(copiedTree!==expectedTree||!matchesCommittedGitTree(root,checkout))throw new Error("Docker build actual source tree does not match committed clean source provenance");
    return createBuildIdentity(root,commitSha);
  }catch(error){
    if(error instanceof Error&&/Docker build/.test(error.message))throw error;
    throw new Error("Docker build requires resolvable portable Git provenance",{cause:error});
  }finally{rmSync(checkout,{recursive:true,force:true});}
}

function git(root:string,args:string[]):string{return execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"],env:isolatedGitEnvironment()});}

function matchesCommittedGitTree(root:string,checkout:string):boolean{
  const committed=new Map<string,{mode:string;hash:string}>();
  for(const record of git(checkout,["ls-tree","-r","-z","HEAD","--",...ATTESTED_GIT_PATHS]).split("\0").filter(Boolean)){
    const match=/^(\d+)\s+blob\s+([0-9a-f]+)\t(.+)$/u.exec(record);if(!match)return false;
    const mode=match[1],hash=match[2],path=match[3];if(!mode||!hash||!path)return false;committed.set(path,{mode,hash});
  }
  const copied=attestedFiles(root);
  if(copied.length!==committed.size||copied.some(path=>!committed.has(path)))return false;
  return copied.every(path=>{
    const entry=committed.get(path)!,absolute=join(root,path),stat=lstatSync(absolute);
    if(stat.isSymbolicLink())return entry.mode==="120000"&&symlinkTargetMatchesCommitted(readlinkSync(absolute),gitBlob(checkout,entry.hash));
    if(!stat.isFile()||(entry.mode!=="100644"&&entry.mode!=="100755"))return false;
    const executable=(stat.mode&0o111)!==0;if(executable!==(entry.mode==="100755"))return false;
    return buffersEquivalent(readFileBytes(absolute),gitBlob(checkout,entry.hash));
  });
}

function attestedFiles(root:string):string[]{
  const result:string[]=[];
  for(const path of ATTESTED_GIT_PATHS){const absolute=join(root,path),stat=lstatSync(absolute);if(stat.isDirectory())walkFiles(root,absolute,result);else result.push(path);}
  return result.sort();
}
function walkFiles(root:string,directory:string,result:string[]):void{for(const name of readdirSync(directory)){const absolute=join(directory,name),stat=lstatSync(absolute),path=relative(root,absolute).replaceAll("\\","/");if(stat.isDirectory()&&!stat.isSymbolicLink())walkFiles(root,absolute,result);else result.push(path);}}
function gitBlob(checkout:string,hash:string):Buffer{return execFileSync("git",["cat-file","blob",hash],{cwd:checkout,encoding:"buffer",stdio:["ignore","pipe","pipe"],env:isolatedGitEnvironment()});}
function readFileBytes(path:string):Buffer{return readFileSync(path);}
function buffersEquivalent(copied:Buffer,committed:Buffer):boolean{
  if(copied.equals(committed))return true;
  const left=utf8Text(copied),right=utf8Text(committed);return left!==undefined&&right!==undefined&&left.replaceAll("\r\n","\n")===right.replaceAll("\r\n","\n");
}
export function symlinkTargetMatchesCommitted(copiedTarget:string,committedBlob:Buffer):boolean{return Buffer.from(copiedTarget,"utf8").equals(committedBlob);}
function utf8Text(value:Buffer):string|undefined{if(value.includes(0))return undefined;try{return new TextDecoder("utf-8",{fatal:true}).decode(value);}catch{return undefined;}}
function isolatedGitEnvironment():NodeJS.ProcessEnv{
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith("GIT_CONFIG_"))delete env[key];
  return {...env,GIT_CONFIG_NOSYSTEM:"1",GIT_CONFIG_GLOBAL:process.platform==="win32"?"NUL":"/dev/null",GIT_CONFIG_COUNT:"0"};
}
