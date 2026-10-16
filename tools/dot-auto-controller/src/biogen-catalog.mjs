import fs from 'node:fs';import path from 'node:path';
import {PACKAGE_ROOT,loadDeploymentBinding} from './biogen-deployment.mjs';
export {PACKAGE_ROOT} from './biogen-deployment.mjs';
export function loadCatalog(){
 const binding=loadDeploymentBinding(),c=JSON.parse(fs.readFileSync(PACKAGE_ROOT+'/config/biogen-native-catalog.json','utf8'));
 const r=c.sources.biogen;
 if(binding.external){Object.assign(r,structuredClone(binding.biogen));r.pins=r.pins.map(p=>({...p,path:path.join(PACKAGE_ROOT,p.path)}));r.newBuildAndCandidateRequired=!r.configured;}
 r.producer=path.join(PACKAGE_ROOT,'vendor/c60-source');r.node=process.execPath;
 r.hostReference=binding.deployment.authorityDirectory?path.join(binding.deployment.authorityDirectory,'biogen'):null;
 return c;
}
