import {execFileSync} from "node:child_process";
import {closeSync,constants,fchmodSync,fstatSync,lstatSync,mkdtempSync,openSync,readdirSync,readFileSync,readlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,relative,resolve} from "node:path";
import {canonicalSourceTreeSha256,createBuildIdentity,type BuildIdentityArtifact} from "./buildIdentity";

export const ATTESTED_GIT_PATHS=["src","scripts","prisma","ops","package.json","package-lock.json","tsconfig.json","Dockerfile",".dockerignore","index.html","vite.config.ts","testExecutionContract.ts"] as const;

export function exportDockerBuildProvenance(root:string,bundlePath:string):void{
  const status=git(root,["status","--porcelain","--",...ATTESTED_GIT_PATHS]);
  if(status.trim())throw new Error("Docker build source provenance is dirty");
  git(root,["bundle","create",resolve(bundlePath),"HEAD"]);
}

export function verifyDockerBuildProvenance(root:string,bundlePath:string,commitSha:string,expectedTree:string,normalizeDockerCopyModes=false):BuildIdentityArtifact{
  const checkout=mkdtempSync(join(tmpdir(),"job-finder-build-provenance-"));
  try{
    execFileSync("git",["clone","--quiet","--no-checkout",resolve(bundlePath),checkout],{stdio:["ignore","ignore","pipe"],env:isolatedGitEnvironment()});
    const bundledHead=git(checkout,["rev-parse","HEAD"]).trim();
    if(bundledHead!==commitSha)throw new Error("Docker build commit argument does not match portable Git provenance");
    const copiedTree=canonicalSourceTreeSha256(root);
    if(copiedTree!==expectedTree)throw new Error("Docker build source tree mismatch: copied-digest");matchesCommittedGitTree(root,checkout,normalizeDockerCopyModes);
    return createBuildIdentity(root,commitSha);
  }catch(error){
    if(error instanceof Error&&/Docker build/.test(error.message))throw error;
    throw new Error("Docker build requires resolvable portable Git provenance",{cause:error});
  }finally{rmSync(checkout,{recursive:true,force:true});}
}

function git(root:string,args:string[]):string{return execFileSync("git",args,{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"],env:isolatedGitEnvironment()});}

function matchesCommittedGitTree(root:string,checkout:string,normalizeDockerCopyModes:boolean):void{
  const committed=new Map<string,{mode:string;hash:string}>();
  for(const record of git(checkout,["ls-tree","-r","-z","HEAD","--",...ATTESTED_GIT_PATHS]).split("\0").filter(Boolean)){
    const match=/^(\d+)\s+blob\s+([0-9a-f]+)\t(.+)$/u.exec(record);if(!match)throw mismatch("invalid-tree-record");
    const mode=match[1],hash=match[2],path=match[3];if(!mode||!hash||!path)throw mismatch("invalid-tree-record");committed.set(path,{mode,hash});
  }
  const copied=attestedFiles(root);
  const extra=copied.find(path=>!committed.has(path));if(extra)throw mismatch("extra",extra);
  const missing=[...committed.keys()].find(path=>!copied.includes(path));if(missing)throw mismatch("missing",missing);
  const regular:{path:string;absolute:string;mode:"100644"|"100755";dev:number;ino:number}[]=[];
  const symlinks:{path:string;absolute:string;dev:number;ino:number}[]=[];
  for(const path of copied){
    const entry=committed.get(path)!,absolute=join(root,path),stat=lstatSync(absolute);
    if(stat.isSymbolicLink()){if(entry.mode!=="120000")throw mismatch("type",path);if(!symlinkTargetMatchesCommitted(readlinkSync(absolute),gitBlob(checkout,entry.hash)))throw mismatch("symlink-target",path);symlinks.push({path,absolute,dev:stat.dev,ino:stat.ino});continue;}
    if(!stat.isFile()||(entry.mode!=="100644"&&entry.mode!=="100755"))throw mismatch("type",path);
    if(!buffersEquivalent(readFileBytes(absolute),gitBlob(checkout,entry.hash)))throw mismatch("content",path);
    const mode=entry.mode;regular.push({path,absolute,mode,dev:stat.dev,ino:stat.ino});
    if(!normalizeDockerCopyModes&&((stat.mode&0o111)!==0)!==(mode==="100755"))throw mismatch("executable-mode",path);
  }
  if(normalizeDockerCopyModes){
    if(!constants.O_NOFOLLOW)throw mismatch("no-nofollow-support");
    const handles:ModeHandle[]=[];let primary:unknown;
    try{
      for(const file of regular)handles.push(openVerifiedModeHandle(file));
      applyModesWithRollback(handles);
      const finalPaths=attestedFiles(root);if(finalPaths.length!==copied.length||finalPaths.some((path,index)=>path!==copied[index]))throw mismatch("path-race");
      for(const handle of handles){const fdStat=fstatSync(handle.fd),pathStat=lstatSync(handle.file.absolute),entry=committed.get(handle.file.path)!;if(!fdStat.isFile()||fdStat.dev!==handle.file.dev||fdStat.ino!==handle.file.ino||!pathStat.isFile()||pathStat.dev!==fdStat.dev||pathStat.ino!==fdStat.ino)throw mismatch("identity-race",handle.file.path);if(((fdStat.mode&0o111)!==0)!==(handle.file.mode==="100755"))throw mismatch("executable-mode",handle.file.path);if(!buffersEquivalent(readFileSync(handle.fd),gitBlob(checkout,entry.hash)))throw mismatch("content-race",handle.file.path);}
      for(const file of symlinks){const stat=lstatSync(file.absolute),entry=committed.get(file.path)!;if(!stat.isSymbolicLink()||stat.dev!==file.dev||stat.ino!==file.ino||!symlinkTargetMatchesCommitted(readlinkSync(file.absolute),gitBlob(checkout,entry.hash)))throw mismatch("symlink-race",file.path);}
    }catch(error){primary=error;throw error;}finally{const closeError=closeAllHandles(handles);if(primary===undefined&&closeError)throw closeError;}
    return;
  }
  const finalPaths=attestedFiles(root);if(finalPaths.length!==copied.length||finalPaths.some((path,index)=>path!==copied[index]))throw mismatch("path-race");
  for(const file of regular){const stat=lstatSync(file.absolute),entry=committed.get(file.path)!;if(!stat.isFile()||stat.dev!==file.dev||stat.ino!==file.ino)throw mismatch("identity-race",file.path);if(((stat.mode&0o111)!==0)!==(file.mode==="100755"))throw mismatch("executable-mode",file.path);if(!buffersEquivalent(readFileBytes(file.absolute),gitBlob(checkout,entry.hash)))throw mismatch("content-race",file.path);}
  for(const file of symlinks){const stat=lstatSync(file.absolute),entry=committed.get(file.path)!;if(!stat.isSymbolicLink()||stat.dev!==file.dev||stat.ino!==file.ino||!symlinkTargetMatchesCommitted(readlinkSync(file.absolute),gitBlob(checkout,entry.hash)))throw mismatch("symlink-race",file.path);}
}
interface ModeHandle{fd:number;file:{path:string;absolute:string;mode:"100644"|"100755";dev:number;ino:number};originalMode:number}
export function openVerifiedModeHandle(file:ModeHandle["file"],open:(path:string,flags:number)=>number=openSync,stat:(fd:number)=>{isFile():boolean;dev:number;ino:number;mode:number}=fstatSync,close:(fd:number)=>void=closeSync):ModeHandle{
  const fd=open(file.absolute,constants.O_RDONLY|constants.O_NOFOLLOW);try{const value=stat(fd);if(!value.isFile()||value.dev!==file.dev||value.ino!==file.ino)throw mismatch("identity-race",file.path);return{fd,file,originalMode:value.mode&0o777};}catch(error){try{close(fd);}catch{}throw error;}
}
export function applyModesWithRollback(handles:ModeHandle[],chmod:(fd:number,mode:number)=>void=fchmodSync):void{try{for(const handle of handles)chmod(handle.fd,handle.file.mode==="100755"?0o755:0o644);}catch(error){for(const handle of handles)try{chmod(handle.fd,handle.originalMode);}catch{}throw error;}}
export function closeAllHandles(handles:Pick<ModeHandle,"fd">[],close:(fd:number)=>void=closeSync):unknown{let first:unknown;for(const {fd} of handles)try{close(fd);}catch(error){if(first===undefined)first=error;}return first;}
function mismatch(kind:string,path?:string):Error{return new Error(`Docker build source tree mismatch: ${kind}${path?` at ${path}`:""}`);}

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
