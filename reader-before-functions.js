// Public reader headers stay compact; original first/latest publication evidence remains exact.
function readerBeforeQueries(query, snapshotTimeout='8s') {
 const prefix="BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='8s';\n";
 const text=value=>"E'"+String(value).replaceAll('\\','\\\\').replaceAll("'","''")+"'";
 const digest=value=>`encode(extensions.digest(convert_to((${value})::text,'UTF8'),'sha256'),'hex')`;
 const between=(start,end)=>{const a=query.indexOf(start),b=query.indexOf(end,a+start.length);if(a<0||b<0||query.indexOf(start,a+1)!==-1)throw Error('READER_QUERY_SHAPE');return query.slice(a+start.length,b);};
 if(!query.startsWith(prefix)||!query.trimEnd().endsWith('ROLLBACK;'))throw Error('READER_QUERY_SHAPE');
 const body=query.slice(prefix.length,query.lastIndexOf('ROLLBACK;')).trim().replace(/;$/,'');
 const matching=between('WITH publication AS (\nWITH matching AS (\n','\n ), jobs AS (');
 const stable="(reader_before-'checkedAt') || jsonb_build_object('publicationContext',(reader_before->'publicationContext')-'checkedAt')";
 const reference=value=>`CASE WHEN ${value} IS NULL OR ${value}='null'::jsonb THEN 'null'::jsonb ELSE jsonb_build_object('id',${value}->>'id','sha256',${digest(value)}) END`;
 const wrap=select=>prefix+select+';\nROLLBACK;';
 const snapshot=select=>wrap(`WITH snapshot AS (${body}) ${select} FROM snapshot`).replace("statement_timeout='8s'","statement_timeout='"+snapshotTimeout+"'");
 return {
  header:snapshot(`SELECT reader_before || jsonb_build_object('results',(SELECT coalesce(jsonb_agg(CASE WHEN r->>'id' IN (reader_before#>>'{publicationContext,firstAccepted,id}',reader_before#>>'{publicationContext,latestAccepted,id}') AND r#>>'{completenessCertificate,schemaVersion}'='job-projection-delta-receipt-v1' AND jsonb_array_length(r#>'{completenessCertificate,members}')>0 THEN jsonb_set(r,'{completenessCertificate,members}','null'::jsonb) ELSE r END ORDER BY r->>'id'),'[]'::jsonb) FROM jsonb_array_elements(reader_before->'results') r),'publicationContext',(reader_before->'publicationContext') || jsonb_build_object('firstAccepted',${reference("reader_before->'publicationContext'->'firstAccepted'")},'latestAccepted',${reference("reader_before->'publicationContext'->'latestAccepted'")})) AS reader_before,${digest(stable)} AS snapshot_sha256`),
  final:snapshot(`SELECT ${digest(stable)} AS snapshot_sha256`),
  publication:id=>wrap(`WITH matching AS (${matching} AND r.id=${text(id)}) SELECT to_jsonb(r) AS row,${digest('to_jsonb(r)')} AS sha256 FROM matching r`)
 };
}

async function readOriginalReaderBefore(query, sql, snapshotTimeout='8s') {
 const queries=readerBeforeQueries(query,snapshotTimeout);
 const one=async query=>{const rows=await sql(query);if(!Array.isArray(rows)||rows.length!==1)throw Error('READER_ROW_COUNT');return rows[0];};
 const header=await one(queries.header),before=header.reader_before;
 if(!/^[a-f0-9]{64}$/.test(header.snapshot_sha256)||!Array.isArray(before.results)||new Set(before.results.map(r=>r.id)).size!==before.results.length)throw Error('READER_HEADER_INVALID');
 const verify=(ref,actual)=>{if(!ref||typeof ref.id!=='string'||!actual?.row||actual.row.id!==ref.id||actual.row.sourceId!==before.sourceId||actual.row.sourceConfigHash!==before.sourceConfigSha256||actual.sha256!==ref.sha256)throw Error('READER_ROW_CHANGED');};
 const publications=new Map();
 for(const key of ['firstAccepted','latestAccepted']){
  const ref=before.publicationContext[key];if(ref===null)continue;
  let actual=publications.get(ref.id);
  if(!actual){actual=await one(queries.publication(ref.id));publications.set(ref.id,actual);}
  verify(ref,actual);before.publicationContext[key]=actual.row;
 }
 // Reuse the exact first/latest record already loaded for publication; avoid transferring its manifest twice.
 for(const row of before.results)if(row.completenessCertificate?.schemaVersion==='job-projection-delta-receipt-v1'&&row.completenessCertificate.members===null){
  const original=publications.get(row.id)?.row.completenessCertificate;if(!Array.isArray(original?.members))throw Error('READER_CURRENT_MEMBERS_REQUIRED');row.completenessCertificate.members=original.members;
 }
 if((await one(queries.final)).snapshot_sha256!==header.snapshot_sha256)throw Error('READER_SNAPSHOT_CHANGED');
 return before;
}
return {readerBeforeQueries,readOriginalReaderBefore};
