// Offline check of the unchanged deployed reader bundle. No database/network.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deserialize} from "node:v8";
import {pathToFileURL} from "node:url";
const {projectPortableSourceJobs}=await import(pathToFileURL(process.argv[2]!).href);
const f=deserialize(readFileSync(process.argv[3]!));
const options={currentTime:new Date(f.currentTime)};
const projected=projectPortableSourceJobs(f.selection,f.members,f.rows,options,f.historicalMembers);
assert.equal(projected.state,"PUBLISHING",JSON.stringify(projected.reasons));assert.equal(projected.visibleJobCount,2);
const old=projected.jobs.find((j:any)=>j.id===f.unknownKey);
assert(old);assert.equal(old.inGrace,true);assert.equal(old.lastSeenAt,f.oldAt);assert.equal(old.lastConfirmedObservedAt,f.oldAt);assert.equal(old.officialTitle,f.oldTitle);
assert(!projected.jobs.some((j:any)=>j.id===f.missingKey));
const tampered=structuredClone(f.members);tampered.find((m:any)=>m.setKind==="VISIBLE"&&m.jobKey===f.unknownKey).missingCount=0;
assert.equal(projectPortableSourceJobs(f.selection,tampered,f.rows,options,f.historicalMembers).state,"HOLD");
assert.equal(projectPortableSourceJobs(f.selection,f.members,f.rows,options,[]).state,"HOLD");
console.log("PASS deployed reader: exact old GRACE visible with old timestamps; normal missing absent; missing history/tampered member HOLD");
