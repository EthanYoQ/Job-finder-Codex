// Pure synthetic regression. No capture, binding, or publication data.
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadBoundPublicationContext} from '../../hosts/servier/host/runtime/review-packet-envelope.mts';
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const ff=Buffer.concat([Buffer.from('{"marker":"'),Buffer.from([0xff]),Buffer.from('"}')]);
const fe=Buffer.concat([Buffer.from('{"marker":"'),Buffer.from([0xfe]),Buffer.from('"}')]);
function inspect(bytes:Buffer,pin:string){
 const host=mkdtempSync(join(tmpdir(),'servier-byte-pin-')),run=join(host,'synthetic-run'),relay=join(run,'relay');mkdirSync(relay,{recursive:true});
 const request={requestId:'synthetic-publish',requestSha256:'a'.repeat(64)},origin=join(run,'review-context-origin.json');
 const candidate={id:'synthetic-candidate'},build={commitSha:'28402a299bb04cbf5873da66c2fe8ca76827c0d1'};
 const put=(path:string,value:unknown)=>writeFileSync(path,JSON.stringify(value));
 put(join(host,'activation.json'),{status:'REGISTERED_VERIFIED',candidate,build,reviewContextOrigins:{[request.requestSha256]:{path:origin,sha256:pin}}});
 put(join(host,'host-config.json'),{root:host});put(join(host,'control-base.json'),{candidate,build});writeFileSync(origin,bytes);
 try{loadBoundPublicationContext(join(relay,request.requestId+'.request.json'),request);}finally{rmSync(host,{recursive:true,force:true});}
}
test('FF and FE replacement decoding collides while original byte hashes differ',()=>{assert.equal(ff.toString('utf8'),fe.toString('utf8'));assert.equal(sha(ff.toString('utf8')),sha(fe.toString('utf8')));assert.notEqual(sha(ff),sha(fe));});
test('exact FF raw byte pin reaches the independent schema gate',()=>assert.throws(()=>inspect(ff,sha(ff)),/^Error: HOST_CONTEXT_ORIGIN_PUBLISH_BINDING$/));
test('FE bytes cannot use the FF raw byte pin',()=>assert.throws(()=>inspect(fe,sha(ff)),/^Error: HOST_CONTEXT_ORIGIN_FILE_HASH$/));
test('FF bytes cannot use the FE raw byte pin',()=>assert.throws(()=>inspect(ff,sha(fe)),/^Error: HOST_CONTEXT_ORIGIN_FILE_HASH$/));
test('neither invalid byte sequence accepts the formerly colliding decoded-string pin',()=>{for(const bytes of [ff,fe])assert.throws(()=>inspect(bytes,sha(bytes.toString('utf8'))),/^Error: HOST_CONTEXT_ORIGIN_FILE_HASH$/);});
test('valid UTF8 original byte pin keeps its previous behavior',()=>{const bytes=Buffer.from('{"marker":"纯合成"}');assert.equal(sha(bytes),sha(bytes.toString('utf8')));assert.throws(()=>inspect(bytes,sha(bytes)),/^Error: HOST_CONTEXT_ORIGIN_PUBLISH_BINDING$/);});
