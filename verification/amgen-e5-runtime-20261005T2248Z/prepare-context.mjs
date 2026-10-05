import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {compileCloudPilotPublicationContextSql} from '../../amgen-two-chain-offline-20261005T2226Z/src/db/cloudPilotSqlControl.ts';
const root='/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/hosts-amgen-e5/amgen';
const control=JSON.parse(readFileSync(root+'/control-base.json','utf8')),{expiresAt,...input}=control;
const sql=compileCloudPilotPublicationContextSql(input);writeFileSync(root+'/context-read.sql',sql,{flag:'wx',mode:0o600});
const spec=JSON.parse(readFileSync(root+'/SPEC.json','utf8'));spec.readContextSqlSha256=createHash('sha256').update(sql).digest('hex');writeFileSync(root+'/SPEC.json',JSON.stringify(spec,null,2)+'\n');
console.log(JSON.stringify({contextSqlSha256:spec.readContextSqlSha256,bytes:Buffer.byteLength(sql),executed:false}));
