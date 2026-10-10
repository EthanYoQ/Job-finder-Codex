import fs from 'node:fs';import path from 'node:path';
export const PACKAGE_ROOT=path.resolve(import.meta.dirname,'..');
export function loadCatalog(){const c=JSON.parse(fs.readFileSync(PACKAGE_ROOT+'/config/native-catalog.json','utf8'));for(const [key,r] of Object.entries(c.sources)){if(key==='takeda'){r.producer=path.join(PACKAGE_ROOT,'vendor/c60-source');r.node=process.execPath;const d=JSON.parse(fs.readFileSync(PACKAGE_ROOT+'/config/deployment.json','utf8'));r.hostReference=d.authorityDirectory?path.join(d.authorityDirectory,'takeda'):null;}}return c;}
