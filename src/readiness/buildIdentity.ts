import {createHash,timingSafeEqual} from "node:crypto";
import {execFileSync} from "node:child_process";
import {lstatSync,readFileSync,readdirSync,readlinkSync,realpathSync} from "node:fs";
import {join,relative,resolve} from "node:path";

export interface BuildIdentityArtifact {schemaVersion:2;commitSha:string;sourceTreeSha256:string;runtimeTreeSha256:string;contentSha256:string}
const FIXED_BUILD_IDENTITY_PATH=resolve(process.cwd(),"build-identity.json");
const sourceRoots=["src","scripts","prisma","ops"] as const;
const runtimeRoots=["dist","src","scripts","prisma","ops","node_modules"] as const;
const sourceFiles=["package.json","package-lock.json","tsconfig.json","Dockerfile",".dockerignore","index.html","vite.config.ts","testExecutionContract.ts"] as const;
const runtimeFiles=["package.json","tsconfig.json"] as const;

export function resolveCurrentBuildIdentity():BuildIdentityArtifact{
  try{
    const status=execFileSync("git",["status","--porcelain"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
    if(status.trim())throw new Error("Running worktree is dirty; release identity is not commit-bound");
    const commitSha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
    return createBuildIdentity(process.cwd(),commitSha);
  }catch(error){
    if(error instanceof Error&&error.message.includes("dirty"))throw error;
    return readAndValidateBakedBuildIdentity();
  }
}
export function createBuildIdentity(root:string,commitSha:string):BuildIdentityArtifact{
  if(!/^[0-9a-f]{40}$/.test(commitSha))throw new Error("Build identity commit SHA is invalid");
  const base={schemaVersion:2 as const,commitSha,sourceTreeSha256:canonicalSourceTreeSha256(root),runtimeTreeSha256:canonicalRuntimeTreeSha256(root)};
  return {...base,contentSha256:digest(JSON.stringify(base))};
}
export function readAndValidateBakedBuildIdentity():BuildIdentityArtifact{
  const root=process.cwd(),path=FIXED_BUILD_IDENTITY_PATH;
  let value:BuildIdentityArtifact;try{value=JSON.parse(readFileSync(path,"utf8")) as BuildIdentityArtifact;}catch{throw new Error("Baked build identity is absent or invalid");}
  if(value.schemaVersion!==2||!validSha(value.sourceTreeSha256)||!validSha(value.runtimeTreeSha256)||!validSha(value.contentSha256)||!/^[0-9a-f]{40}$/.test(value.commitSha))throw new Error("Baked build identity format is invalid");
  const expected=digest(JSON.stringify({schemaVersion:value.schemaVersion,commitSha:value.commitSha,sourceTreeSha256:value.sourceTreeSha256,runtimeTreeSha256:value.runtimeTreeSha256}));
  if(!safeEqual(expected,value.contentSha256)||!safeEqual(canonicalRuntimeTreeSha256(root),value.runtimeTreeSha256))throw new Error("Baked build identity digest or runtime tree binding mismatch");
  return Object.freeze(value);
}
export const canonicalSourceTreeSha256=(root:string)=>canonicalTree(root,sourceRoots,sourceFiles);
export const canonicalRuntimeTreeSha256=(root:string)=>canonicalTree(root,runtimeRoots,runtimeFiles);
function canonicalTree(root:string,roots:readonly string[],files:readonly string[]):string{
  for(const path of [...files,...roots])if(!statSafe(join(root,path)))throw new Error(`Attested tree root is missing: ${path}`);
  const paths=[...files,...roots.flatMap(dir=>walk(root,join(root,dir)))].sort();
  const hash=createHash("sha256");for(const path of paths){const absolute=join(root,path),stat=lstatSync(absolute);const bytes=stat.isSymbolicLink()?Buffer.concat([Buffer.from(`SYMLINK\0${readlinkSync(absolute)}\0TARGET\0`,"utf8"),readFileSync(realpathSync(absolute))]):readFileSync(absolute);const name=Buffer.from(path,"utf8");const header=Buffer.alloc(8);header.writeUInt32BE(name.length,0);header.writeUInt32BE(bytes.length,4);hash.update(header).update(name).update(bytes);}return hash.digest("hex");
}
function walk(root:string,path:string):string[]{return readdirSync(path).flatMap(name=>{const child=resolve(path,name),stat=lstatSync(child),rel=relative(root,child).replaceAll("\\","/");if(rel==="node_modules/.vite")return [];if(stat.isSymbolicLink()){const target=realpathSync(child),rootReal=realpathSync(root);if(target!==rootReal&&!target.startsWith(rootReal+"/")&&!target.startsWith(rootReal+"\\"))throw new Error("Attested tree symlink escapes root");if(lstatSync(target).isDirectory())throw new Error("Attested tree directory symlink or loop is forbidden");return[rel];}return stat.isDirectory()?walk(root,child):[rel]});}
function statSafe(path:string){try{const stat=lstatSync(path);return stat.isFile()||stat.isDirectory();}catch{return false;}}
const digest=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");const validSha=(value:string)=>/^[0-9a-f]{64}$/.test(value);
function safeEqual(a:string,b:string){return validSha(a)&&validSha(b)&&timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));}
