/** Independent pre-import verifier. Uses only trusted Node builtins. */
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync,readlinkSync,realpathSync,statSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
export const REVIEWED_NODE_PROFILE=Object.freeze({version:'v22.23.3',platform:'linux',arch:'x64',binarySha256:'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'});
const digest=value=>createHash('sha256').update(value).digest('hex');
const sha=/^[a-f0-9]{64}$/;
function tree(root,roots,files){
 for(const path of [...files,...roots]){const s=lstatSync(join(root,path));if(!s.isFile()&&!s.isDirectory())throw Error('INTEGRITY_REQUIRED_ROOT');}
 function walk(path){return readdirSync(path).flatMap(name=>{
  const child=resolve(path,name),s=lstatSync(child),rel=relative(root,child).replaceAll('\\','/');
  if(rel==='node_modules/.vite')return[];
  if(s.isSymbolicLink()){
   const target=realpathSync(child),rootReal=realpathSync(root);
   if(target!==rootReal&&!target.startsWith(rootReal+'/'))throw Error('INTEGRITY_SYMLINK_ESCAPE');
   if(lstatSync(target).isDirectory())throw Error('INTEGRITY_DIRECTORY_SYMLINK');return[rel];
  }
  if(!s.isDirectory()&&!s.isFile())throw Error('INTEGRITY_SPECIAL_FILE');
  return s.isDirectory()?walk(child):[rel];
 });}
 const paths=[...files,...roots.flatMap(dir=>walk(join(root,dir)))].sort(),hash=createHash('sha256');
 for(const path of paths){const abs=join(root,path),s=lstatSync(abs);
  const bytes=s.isSymbolicLink()?Buffer.concat([Buffer.from(`SYMLINK\0${readlinkSync(abs)}\0TARGET\0`),readFileSync(realpathSync(abs))]):readFileSync(abs);
  const name=Buffer.from(path),header=Buffer.alloc(8);header.writeUInt32BE(name.length,0);header.writeUInt32BE(bytes.length,4);hash.update(header).update(name).update(bytes);
 }
 return hash.digest('hex');
}
export function verifyRuntimeBeforeImport(root,expectedBuild,expectedLockSha256,nodeProfile=REVIEWED_NODE_PROFILE){
 if(!expectedBuild||expectedBuild.schemaVersion!==2||!/^([a-f0-9]{40})$/.test(expectedBuild.commitSha)||
    ['sourceTreeSha256','runtimeTreeSha256','contentSha256'].some(k=>!sha.test(expectedBuild[k]??''))||!sha.test(expectedLockSha256??'')||
    !nodeProfile||!sha.test(nodeProfile.binarySha256??''))throw Error('INTEGRITY_PIN_FORMAT');
 if(process.version!==nodeProfile.version||process.platform!==nodeProfile.platform||process.arch!==nodeProfile.arch)throw Error('INTEGRITY_NODE_PROFILE');
 const running=statSync('/proc/self/exe',{bigint:true}),named=statSync(process.execPath,{bigint:true});
 if(running.dev!==named.dev||running.ino!==named.ino||realpathSync('/proc/self/exe')!==realpathSync(process.execPath)||
    digest(readFileSync('/proc/self/exe'))!==nodeProfile.binarySha256)throw Error('INTEGRITY_NODE_BINARY');
 if(digest(readFileSync(join(root,'package-lock.json')))!==expectedLockSha256)throw Error('INTEGRITY_DEPENDENCY_LOCK');
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
 const source=tree(root,['src','scripts','prisma','ops'],['package.json','package-lock.json','tsconfig.json','Dockerfile','.dockerignore','index.html','vite.config.ts','testExecutionContract.ts']);
 const runtime=tree(root,['dist','src','scripts','prisma','ops','node_modules'],['package.json','tsconfig.json']);
 const actual={schemaVersion:2,commitSha:commit,sourceTreeSha256:source,runtimeTreeSha256:runtime};
 actual.contentSha256=digest(JSON.stringify(actual));
 if(Object.keys(expectedBuild).sort().join(',')!==Object.keys(actual).sort().join(',')||Object.entries(actual).some(([k,v])=>expectedBuild[k]!==v))throw Error('INTEGRITY_BUILD_MISMATCH');
 return Object.freeze(actual);
}
