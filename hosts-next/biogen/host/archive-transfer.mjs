import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const MAX_BYTES=16*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Transfer-only compression: the original owned archive is never rewritten. */
export function packArchiveTransfer(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>MAX_BYTES)throw Error('TRANSFER_INPUT_SIZE');
 const gzip=gzipSync(bytes,{level:9}),chunks=[];
 for(let offset=0;offset<gzip.length;offset+=576)chunks.push(gzip.subarray(offset,offset+576).toString('base64'));
 return Buffer.from(JSON.stringify({schemaVersion:1,encoding:'gzip-base64',sha256:sha(bytes),byteCount:bytes.length,chunks},null,2));
}
export function unpackArchiveTransfer(packed,expectedSha256,expectedByteCount){
 if(!Buffer.isBuffer(packed)||packed.length>MAX_BYTES*2)throw Error('TRANSFER_PACKED_SIZE');
 const v=JSON.parse(packed.toString('utf8'));
 if(!v||Object.keys(v).sort().join(',')!=='byteCount,chunks,encoding,schemaVersion,sha256'||v.schemaVersion!==1||v.encoding!=='gzip-base64'||!Array.isArray(v.chunks)||!v.chunks.length||!v.chunks.every(c=>typeof c==='string'&&c.length<=768)||!Number.isSafeInteger(v.byteCount)||v.byteCount<1||v.byteCount>MAX_BYTES||!/^[a-f0-9]{64}$/.test(v.sha256))throw Error('TRANSFER_ENVELOPE');
 if(v.sha256!==expectedSha256||v.byteCount!==expectedByteCount)throw Error('TRANSFER_ORIGINAL_BINDING');
 const compressed=Buffer.concat(v.chunks.map(chunk=>{const bytes=Buffer.from(chunk,'base64');if(bytes.toString('base64')!==chunk)throw Error('TRANSFER_BASE64');return bytes;}));
 const bytes=gunzipSync(compressed,{maxOutputLength:v.byteCount});
 if(bytes.length!==v.byteCount||sha(bytes)!==v.sha256)throw Error('TRANSFER_ORIGINAL_BYTES');
 return bytes;
}
