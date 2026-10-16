/** Independent source-specific raw Workday projection. No HTTP or SQL. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hasUniqueJsonObjectKeys} from '../vendor/c60-source/src/crawler/strictJsonObjectKeys.ts';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const locations=[{descriptor:'Shanghai, China',id:'c20707a4650c018390f4e48ed845efa6',city:'Shanghai',normalized:'上海'},{descriptor:'Beijing, China',id:'1d1ae2cf252d013639674034b420cda4',city:'Beijing',normalized:'北京'}];
const groups=(v:any,key:string):any[]=>Array.isArray(v)?v.flatMap(x=>groups(x,key)):v&&typeof v==='object'?[...(v.facetParameter===key?[v]:[]),...groups(v.values,key)]:[];
export function reviewBiogenRawPages(bodies:string[],currentRows:any[],nativeRows:any[]){
 assert(bodies.length>0&&bodies.length<=3,'BIOGEN_PAGE_LIMIT');
 const records:any[]=[],ids=new Set<string>();let total:number|undefined,facets:string|undefined;
 for(const [index,body]of bodies.entries()){
  assert(hasUniqueJsonObjectKeys(body),'BIOGEN_DUPLICATE_JSON_KEY');const root=JSON.parse(body);assert(Number.isSafeInteger(root.total)&&root.total>=0);assert(Array.isArray(root.jobPostings));
  if(total!==undefined)assert.equal(root.total,total);total=root.total;
  const countries=groups(root.facets,'locationCountry'),places=groups(root.facets,'locations');assert.equal(countries.length,1);assert.equal(places.length,1);assert(Array.isArray(countries[0].values)&&Array.isArray(places[0].values));
  const cs=countries[0].values;assert(cs.every((c:any)=>typeof c.id==='string'&&typeof c.descriptor==='string'&&Number.isSafeInteger(c.count)&&c.count>=0));assert.equal(new Set(cs.map((c:any)=>c.id)).size,cs.length);
  const china=cs.filter((c:any)=>c.id==='6cb77610a8a543aea2d6bc10457e35d4'||c.descriptor==='China');assert.deepEqual(china.map((c:any)=>({id:c.id,descriptor:c.descriptor,count:c.count})),[{id:'6cb77610a8a543aea2d6bc10457e35d4',descriptor:'China',count:total}]);
  const ls=places[0].values;assert(ls.every((l:any)=>locations.some(k=>k.id===l.id&&k.descriptor===l.descriptor)&&Number.isSafeInteger(l.count)&&l.count>0));assert.equal(new Set(ls.map((l:any)=>l.id)).size,ls.length);assert.equal(ls.reduce((n:number,l:any)=>n+l.count,0),total);
  const shape=JSON.stringify(ls.map((l:any)=>({id:l.id,count:l.count})).sort((a:any,b:any)=>a.id.localeCompare(b.id)));if(facets!==undefined)assert.equal(shape,facets);facets=shape;
  assert.equal(root.jobPostings.length,Math.min(20,total!-20*index),'BIOGEN_PAGE_CARDINALITY');
  for(const row of root.jobPostings){
   assert(Object.keys(row).every(k=>['title','externalPath','locationsText','postedOn','remoteType','bulletFields'].includes(k)));assert(typeof row.title==='string'&&row.title.trim());assert(typeof row.externalPath==='string');
   const location=locations.find(l=>l.descriptor===row.locationsText);assert(location);
   const match=/^\/job\/(Shanghai|Beijing)-China\/[^/?#\s]+_(REQ[0-9]+)-[1-9][0-9]*$/u.exec(row.externalPath);assert(match);assert.equal(match[1],location.city);assert.deepEqual(row.bulletFields,[match[2]]);assert(!ids.has(match[2]));ids.add(match[2]);
   let cities=[location.normalized];if(/\blocations?\b|工作地点|工作地|地点/iu.test(row.title)){const clauses=[...row.title.matchAll(/\(Location:\s*([^()]+)\)/gu)];assert.equal(clauses.length,1);const city=clauses[0][1].trim();assert(['Shanghai','Beijing','Wuhan','Urumqi','Urumqi\u200c','Changsha'].includes(city));assert(!/\blocations?\b|工作地点|工作地|地点/iu.test(row.title.replace(clauses[0][0],'')));if(city!==location.city)cities=['城市待核'];}
   records.push({sourceJobId:'workday:sha256:'+hash(row.externalPath),officialTitle:row.title.replace(/\s+/gu,' ').trim(),officialUrl:'https://biibhr.wd3.myworkdayjobs.com/external'+row.externalPath,locationRaw:row.locationsText,cities});
  }
 }
 assert.equal(records.length,total);assert.equal(bodies.length,Math.max(1,Math.ceil(total!/20)));
 const root=JSON.parse(bodies[0]);for(const l of groups(root.facets,'locations')[0].values)assert.equal(records.filter(r=>r.locationRaw===l.descriptor).length,l.count);
 for(const rows of [currentRows,nativeRows]){assert.equal(rows.length,records.length);assert.equal(new Set(rows.map(j=>j.sourceJobId)).size,rows.length);for(const raw of records){const j=rows.find(j=>j.sourceJobId===raw.sourceJobId);assert(j);for(const[k,v]of Object.entries(raw))assert.deepEqual(j[k],v);assert.equal(j.sourceId,'source-biogen-china-social');assert.equal(j.companyId,'company-biogen-china');assert(j.officialPublishedAt==null);}}
 for(const native of nativeRows){const current=currentRows.find(j=>j.sourceJobId===native.sourceJobId);for(const key of ['companyId','sourceId','sourceJobId','officialTitle','officialUrl','listUrl','locationRaw','cities'])assert.deepEqual(current[key],native[key]);assert.equal(native.officialPublishedAt,undefined);assert.equal(current.officialPublishedAt,null);}
 return records;
}
