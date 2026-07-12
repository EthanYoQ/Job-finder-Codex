import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTERNAL_EVIDENCE_EXPECTED_PATHS, EXTERNAL_EVIDENCE_MANIFEST_SCHEMA, validateExternalEvidenceRoot } from "../../src/evidence/externalEvidenceValidator";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
function renameWithWindowsRetry(source:string,target:string){for(let attempt=0;;attempt+=1){try{renameSync(source,target);return}catch(error){const code=(error as NodeJS.ErrnoException).code;if(process.platform!=="win32"||(code!=="EPERM"&&code!=="EBUSY")||attempt>=9)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25)}}}
function fixture(mutator?:(files:any[])=>void){const root=mkdtempSync(join(tmpdir(),"external-evidence-"));const values=Object.fromEntries(EXTERNAL_EVIDENCE_EXPECTED_PATHS.map(path=>[path,`${path}\n`]));for(const [path,value] of Object.entries(values)){mkdirSync(join(root,path,".."),{recursive:true});writeFileSync(join(root,path),value)}const files=Object.entries(values).map(([path,value])=>({path,bytes:Buffer.byteLength(value),sha256:digest(value)}));mutator?.(files);const manifest=join(root,"manifest.json"),raw=JSON.stringify({schemaVersion:EXTERNAL_EVIDENCE_MANIFEST_SCHEMA,files});writeFileSync(manifest,raw);return{root,manifest,pin:digest(raw),files};}
describe("external evidence validator",()=>{
 it("accepts the exact pinned fixture",()=>{const x=fixture();expect(validateExternalEvidenceRoot({root:x.root,manifestPath:x.manifest,manifestSha256:x.pin}).root).toBe(x.root)});
 it("consumes immutable captured bytes after disk replacement",()=>{const x=fixture();const snapshot=validateExternalEvidenceRoot({root:x.root,manifestPath:x.manifest,manifestSha256:x.pin});const path=EXTERNAL_EVIDENCE_EXPECTED_PATHS[0];const before=snapshot.text(path);writeFileSync(join(x.root,path),"replaced\n");expect(snapshot.text(path)).toBe(before)});
 it.each([
  ["subset",(f:any[])=>f.pop()], ["extra",(f:any[])=>f.push({...f[0]!,path:"fixtures/extra.json"})],
  ["duplicate",(f:any[])=>f.push({...f[0]!})], ["traversal",(f:any[])=>f[0]!.path="../batch.json"],
  ["hash mismatch",(f:any[])=>f[0]!.sha256="0".repeat(64)]
 ])("rejects %s",(_name,mutate)=>{const x=fixture(mutate);expect(()=>validateExternalEvidenceRoot({root:x.root,manifestPath:x.manifest,manifestSha256:x.pin})).toThrow()});
 it("rejects a symlink parent component",()=>{const x=fixture();const outside=mkdtempSync(join(tmpdir(),"outside-evidence-"));const first=x.files[0]!.path;const top=first.split("/")[0]!;const original=join(x.root,top);const moved=join(outside,top);renameWithWindowsRetry(original,moved);symlinkSync(moved,original,"junction");expect(()=>validateExternalEvidenceRoot({root:x.root,manifestPath:x.manifest,manifestSha256:x.pin})).toThrow()});
 it("rejects a parent junction even when its target remains inside root",()=>{const x=fixture();const top=x.files[0]!.path.split("/")[0]!,original=join(x.root,top),real=join(x.root,`${top}-real`);renameWithWindowsRetry(original,real);symlinkSync(real,original,"junction");expect(()=>validateExternalEvidenceRoot({root:x.root,manifestPath:x.manifest,manifestSha256:x.pin})).toThrow(/junction|symlink/u)});
});
