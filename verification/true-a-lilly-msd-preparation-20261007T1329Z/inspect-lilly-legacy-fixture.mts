// Bounded diagnosis of existing synthetic helper compatibility; no live transport.
import {captureSyntheticLilly} from '../../producer/tests/helpers/lillyPhenom.ts';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const {result,requests}=await captureSyntheticLilly();
const report={classification:'EXISTING_SYNTHETIC_FIXTURE_DIAGNOSIS',status:result.status,truth:result.truth,failureReason:result.failureReason,detailRequests:requests.filter(r=>r.url.includes('myworkdayjobs.com')).map(r=>({url:r.url,method:r.method})),fixtureOnlySupportsEntryAndList:true,noLiveHttp:true,noSql:true};
writeFileSync(join(import.meta.dirname,'LILLY_EXISTING_FIXTURE_DIAGNOSIS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
