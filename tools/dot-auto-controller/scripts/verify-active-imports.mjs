/** Offline conservative source-import closure. Does not execute target modules.
 * Dynamic imports require reviewed fixed roots, and every literal module target
 * in that importing module must resolve under them. Unknown dynamics fail closed.
 */
import fs from 'node:fs';import path from 'node:path';import {isBuiltin,createRequire} from 'node:module';import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
const extensions=['','.ts','.mts','.mjs','.js','.cjs','.tsx','.json','/index.ts','/index.mts','/index.mjs','/index.js'];
const code=/\.(?:[cm]?js|[cm]?ts|tsx)$/;
export function verifyActiveImports(root,config=JSON.parse(fs.readFileSync(path.join(root,'config/active-import-roots.json')))){
 root=path.resolve(root);const pkg=JSON.parse(fs.readFileSync(path.join(root,'vendor/c60-source/package.json'))),lock=JSON.parse(fs.readFileSync(path.join(root,'vendor/c60-source/package-lock.json'))),allowed=new Set([...Object.keys(pkg.dependencies??{}),...Object.keys(pkg.devDependencies??{}),...Object.keys(lock.packages??{}).filter(p=>p.includes('node_modules/')).map(p=>p.split('node_modules/').at(-1))]),visited=new Set(),queue=config.entrypoints.map(p=>inside(path.resolve(root,p))),edges=[],dynamic=[];
 function inside(p){if(p!==root&&!p.startsWith(root+path.sep))throw Error('ACTIVE_IMPORT_OUTSIDE_PACKAGE:'+p);return p;}
 function resolveFile(p){inside(p);for(const ext of extensions){const q=p+ext;if(fs.existsSync(q)&&fs.statSync(q).isFile()&&!fs.lstatSync(q).isSymbolicLink())return q;}throw Error('ACTIVE_IMPORT_MISSING:'+path.relative(root,p));}
 function dependency(spec,from){const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];if(!allowed.has(name))throw Error('UNDECLARED_ACTIVE_DEPENDENCY:'+path.relative(root,from)+':'+spec);let target;try{target=createRequire(from).resolve(spec);}catch{throw Error('ACTIVE_DEPENDENCY_MISSING:'+spec);}edges.push({from:path.relative(root,from),dependency:spec,classification:'DECLARED_LOCKED_DEPENDENCY'});return target;}
 function edge(spec,from){if(isBuiltin(spec)){edges.push({from:path.relative(root,from),builtin:spec});return;}if(spec.startsWith('.')||spec.startsWith('/')){const target=resolveFile(path.resolve(path.dirname(from),spec));edges.push({from:path.relative(root,from),to:path.relative(root,target)});queue.push(target);}else dependency(spec,from);}
 while(queue.length){const file=resolveFile(queue.shift());if(visited.has(file))continue;visited.add(file);if(!code.test(file))continue;const relative=path.relative(root,file).split(path.sep).join('/'),text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),literalPaths=new Set(),nonliteral=[];
  function visit(n){if(ts.isStringLiteralLike(n)&&/^(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.(?:[cm]?js|[cm]?ts|tsx)$/.test(n.text.replace(/^\//,'')))literalPaths.add(n.text);
   if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteralLike(n.moduleSpecifier))edge(n.moduleSpecifier.text,file);
   if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(n.expression)&&n.expression.text==='require')){const arg=n.arguments[0];if(arg&&ts.isStringLiteralLike(arg))edge(arg.text,file);else if(n.expression.kind===ts.SyntaxKind.ImportKeyword)nonliteral.push(n.getText(ast));}
   ts.forEachChild(n,visit);
  }visit(ast);
  if(nonliteral.length){if(JSON.stringify(nonliteral)!==JSON.stringify(config.dynamicExpressions?.[relative]))throw Error('UNREVIEWED_DYNAMIC_IMPORT_EXPRESSION:'+relative);const roots=config.dynamicSourceRoots[relative];if(!roots?.length)throw Error('UNDECLARED_DYNAMIC_IMPORT:'+relative);if(!literalPaths.size)throw Error('UNBOUND_DYNAMIC_IMPORT:'+relative);
   for(const literal of literalPaths){if(literal.startsWith('./')||literal.startsWith('../')){edge(literal,file);continue;}const dep=literal.replace(/^\//,'');if(dep.startsWith('node_modules/')){const parts=dep.slice(13).split('/'),name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];if(!allowed.has(name))throw Error('UNDECLARED_ACTIVE_DEPENDENCY:'+name);const candidates=[path.join(root,dep),...roots.map(r=>path.join(root,r,dep))];if(!candidates.some(p=>fs.existsSync(p)&&fs.statSync(p).isFile()))throw Error('ACTIVE_DEPENDENCY_FILE_MISSING:'+dep);edges.push({from:relative,dependency:dep,classification:'DECLARED_LOCKED_DEPENDENCY'});continue;}
    if(literal.startsWith('/'))throw Error('ACTIVE_IMPORT_ABSOLUTE:'+literal);
    const candidates=[];for(const base of roots){try{candidates.push(resolveFile(path.resolve(root,base,literal)));}catch(e){if(!e.message.startsWith('ACTIVE_IMPORT_MISSING:'))throw e;}}
    if(!candidates.length)throw Error('DYNAMIC_IMPORT_MISSING:'+relative+':'+literal);for(const target of new Set(candidates)){edges.push({from:relative,to:path.relative(root,target),dynamic:true});queue.push(target);}
   }dynamic.push({file:relative,expressions:nonliteral.length,reviewedRoots:roots});
  }
 }
 const files=[...visited].map(f=>({path:path.relative(root,f).split(path.sep).join('/'),sha256:createHash('sha256').update(fs.readFileSync(f)).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path));
 return {schemaVersion:1,status:'ACTIVE_SOURCE_IMPORT_CLOSURE_PASS',sourceFiles:files.length,files,edges,dynamic,quarantinedNotEntrypoints:config.quarantinedNotEntrypoints};
}
if(process.argv[1]===import.meta.filename){const result=verifyActiveImports(path.resolve(import.meta.dirname,'..'));console.log(JSON.stringify({status:result.status,sourceFiles:result.sourceFiles,edges:result.edges.length,dynamicModules:result.dynamic.length}));}
