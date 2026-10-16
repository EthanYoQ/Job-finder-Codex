/** Synthetic unit inputs; executes exact original binding validator source. */
import fs from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const here=new URL('./',import.meta.url),host=new URL('../',here),read=u=>fs.readFileSync(u,'utf8');
const digest=read(new URL('functions/sha256.js',host));
function validator(template){const start=template.indexOf('const activationRowKeys='),end=template.indexOf('let activationAttempted=');assert(start>=0&&end>start);return new Function(digest+'\nconst activationDigest=responseDigest;\n'+template.slice(start,end)+'\nreturn {validate:activationBindingValid,canonical:activationCanonical,keys:activationRowKeys};')();}
const original=validator(read(new URL('functions/lifecycle-activation.template.js',host))),profile=validator(read(new URL('lifecycle-activation.template.js',here)));
function binding(api,sourceId){const commit='c'.repeat(40),row=Object.fromEntries(api.keys.map(k=>[k,k==='commitSha'?commit:'synthetic-'+k]));const b={schemaVersion:1,deployment:{kind:'LIVE_DEPLOYMENT',fixturePreloadSha256:null,projectId:'yiopvxysxrtrnvqxwgbx',sourceId,expectedRow:row,build:{commitSha:commit}},remoteCommit:{commitSha:commit,kind:'OFFICIAL_GITHUB_COMMIT_READ'},enabledEntryBytes:99,disabledEntryBytes:100};for(const k of ['sourceManifestSha256','canonicalDefaultSha256','builderSha256','deploymentSha256','cliSha256','disabledEntrySha256','enabledEntrySha256'])b[k]='a'.repeat(64);b.bindingSha256=createHash('sha256').update(api.canonical(b)).digest('hex');return b;}
assert.equal(profile.validate(binding(profile,'source-biogen-china-social')),true);
assert.equal(profile.validate(binding(profile,'source-takeda-china-social')),false);
assert.equal(original.validate(binding(original,'source-takeda-china-social')),true);
assert.equal(original.validate(binding(original,'source-biogen-china-social')),false);
const tampered=binding(profile,'source-biogen-china-social');tampered.deployment.sourceId='source-takeda-china-social';assert.equal(profile.validate(tampered),false);
const defaultBio=read(new URL('functions-activate.js',here));assert(defaultBio.includes("d.sourceId==='source-biogen-china-social'"));assert(!defaultBio.includes("d.sourceId==='source-takeda-china-social'"));
console.log(JSON.stringify({kind:'SYNTHETIC_EXACT_ACTIVATION_SOURCE_BINDING',passed:true,cases:7,productionCalls:0}));
