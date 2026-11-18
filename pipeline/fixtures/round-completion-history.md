# Verify the historical completion fixture

`round-completion-history.json` contains selected fields from three local audit summaries. The source files remain in the outer project's `.audit` directory. Each fixture entry records the source filename, raw-byte SHA-256, and byte count. These hashes identify the audit summaries; they do not identify the original HTTP response bodies.

Run the following PowerShell command from the repository root. Change the final path if the audit files are stored elsewhere. The command checks every checksum and compares every retained evidence field with its source.

```powershell
@'
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const fixture=JSON.parse(await readFile('pipeline/fixtures/round-completion-history.json','utf8'));
const auditDir=process.argv[2];
const summaries={};
for(const [name,sample] of Object.entries(fixture)){
  const bytes=await readFile(resolve(auditDir,sample.provenance));
  assert.equal(bytes.length,sample.provenanceBytes,sample.provenance);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sample.provenanceSha256,sample.provenance);
  summaries[name]=JSON.parse(bytes.toString('utf8'));
}
const roche=summaries.roche.rows.find(row=>row.id===fixture.roche.sourceResultId);
const projections={
  roche:{...roche,sourceResultId:roche.id,losses:summaries.roche.findings[fixture.roche.sourceId].losses},
  rocheS22:{...summaries.rocheS22,batchId:summaries.rocheS22.archiveBatch},
  novartis:summaries.novartis
};
for(const [name,sample] of Object.entries(fixture)){
  for(const [field,value] of Object.entries(sample)){
    if(!field.startsWith('provenance'))assert.deepEqual(projections[name][field],value,`${name}.${field}`);
  }
}
console.log('Verified 3 audit summaries and all retained evidence fields.');
'@ | node --input-type=module - 'C:/Vibe Coding Project/Job-finder-codex/.audit'
```

Then run the completion regression:

```powershell
node --import ./runner-candidate/scripts/local-check-loader.mjs --test pipeline/source-completion.test.mjs
```

The regression combines the archived Roche counts with 35 synthetic healthy sources. The source-result wrapper and relation records are test data reconstructed from the summaries. The test proves completion decisions for these recorded counts and markers; it does not replay the original network responses or prove current production coverage.
