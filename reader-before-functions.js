// The original object is restored before any caller sees it; only connector response size changes.
function readerBeforeQueries(query) {
 const prefix="BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='8s';\n";
 const text=value=>"E'"+String(value).replaceAll('\\','\\\\').replaceAll("'","''")+"'";
 const digest=value=>`encode(extensions.digest(convert_to((${value})::text,'UTF8'),'sha256'),'hex')`;
 const between=(start,end)=>{const a=query.indexOf(start),b=query.indexOf(end,a+start.length);if(a<0||b<0||query.indexOf(start,a+1)!==-1)throw Error('READER_QUERY_SHAPE');return query.slice(a+start.length,b);};
 if(!query.startsWith(prefix)||!query.trimEnd().endsWith('ROLLBACK;'))throw Error('READER_QUERY_SHAPE');
 const body=query.slice(prefix.length,query.lastIndexOf('ROLLBACK;')).trim().replace(/;$/,'');
 const matching=between('WITH publication AS (\nWITH matching AS (\n','\n ), jobs AS (');
 const writers=between('), writers AS (\n','\n), jobs AS (SELECT to_jsonb(j) AS row');
 const stable="(reader_before-'checkedAt') || jsonb_build_object('publicationContext',(reader_before->'publicationContext')-'checkedAt')";
 const reference=value=>`CASE WHEN ${value} IS NULL OR ${value}='null'::jsonb THEN 'null'::jsonb ELSE jsonb_build_object('id',${value}->>'id','sha256',${digest(value)}) END`;
 const wrap=select=>prefix+select+';\nROLLBACK;';
 const snapshot=select=>wrap(`WITH snapshot AS (${body}) ${select} FROM snapshot`);
 return {
  header:snapshot(`SELECT reader_before || jsonb_build_object('results',coalesce((SELECT jsonb_agg(${reference('value')} ORDER BY ordinality) FROM jsonb_array_elements(reader_before->'results') WITH ORDINALITY),'[]'::jsonb),'publicationContext',(reader_before->'publicationContext') || jsonb_build_object('firstAccepted',${reference("reader_before->'publicationContext'->'firstAccepted'")},'latestAccepted',${reference("reader_before->'publicationContext'->'latestAccepted'")})) AS reader_before,${digest(stable)} AS snapshot_sha256`),
  final:snapshot(`SELECT ${digest(stable)} AS snapshot_sha256`),
  writer:id=>wrap(`WITH writers AS (${writers} AND r.id=${text(id)}) SELECT row,${digest('row')} AS sha256,${digest("row-'batch'-'_count'")} AS publication_sha256 FROM writers`),
  publication:id=>wrap(`WITH matching AS (${matching} AND r.id=${text(id)}) SELECT to_jsonb(r) AS row,${digest('to_jsonb(r)')} AS sha256 FROM matching r`)
 };
}

async function readOriginalReaderBefore(query, sql) {
 const queries=readerBeforeQueries(query);
 const one=async query=>{const rows=await sql(query);if(!Array.isArray(rows)||rows.length!==1)throw Error('READER_ROW_COUNT');return rows[0];};
 const header=await one(queries.header),before=header.reader_before,refs=before.results,loaded=new Map();
 if(!/^[a-f0-9]{64}$/.test(header.snapshot_sha256)||!Array.isArray(refs)||new Set(refs.map(r=>r.id)).size!==refs.length)throw Error('READER_HEADER_INVALID');
 const verify=(ref,actual)=>{if(!ref||typeof ref.id!=='string'||!actual?.row||actual.row.id!==ref.id||actual.row.sourceId!==before.sourceId||actual.row.sourceConfigHash!==before.sourceConfigSha256||actual.sha256!==ref.sha256)throw Error('READER_ROW_CHANGED');};
 before.results=[];
 for(const ref of refs){const actual=await one(queries.writer(ref.id));verify(ref,actual);loaded.set(ref.id,actual);before.results.push(actual.row);}
 const publications=new Map();
 for(const key of ['firstAccepted','latestAccepted']){
  const ref=before.publicationContext[key];if(ref===null)continue;
  let actual=publications.get(ref.id);
  if(!actual){
   const writer=loaded.get(ref.id);
   if(writer){const {batch,_count,...row}=writer.row;actual={row,sha256:writer.publication_sha256};}
   else actual=await one(queries.publication(ref.id));
   publications.set(ref.id,actual);
  }
  verify(ref,actual);before.publicationContext[key]=actual.row;
 }
 if((await one(queries.final)).snapshot_sha256!==header.snapshot_sha256)throw Error('READER_SNAPSHOT_CHANGED');
 return before;
}
return {readerBeforeQueries,readOriginalReaderBefore};
