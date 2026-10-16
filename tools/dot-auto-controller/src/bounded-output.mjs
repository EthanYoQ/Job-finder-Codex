import {createHash} from 'node:crypto';
// This is a diagnostic retention cap, not an IPC-message or crawl-output limit.
// Structured stdout must fit in its entirety; consumers must never parse a tail.
export const DIAGNOSTIC_TAIL_BYTES=65536;
export function createBoundedOutput(){
 const tail=Buffer.alloc(DIAGNOSTIC_TAIL_BYTES),hash=createHash('sha256');
 let retainedBytes=0,totalBytes=0;
 return {
  append(bytes){
   hash.update(bytes);totalBytes+=bytes.length;
   if(bytes.length>=tail.length){bytes.copy(tail,0,bytes.length-tail.length);retainedBytes=tail.length;return;}
   const overflow=Math.max(0,retainedBytes+bytes.length-tail.length);
   if(overflow){tail.copyWithin(0,overflow,retainedBytes);retainedBytes-=overflow;}
   bytes.copy(tail,retainedBytes);retainedBytes+=bytes.length;
  },
  finish(){return {text:tail.subarray(0,retainedBytes).toString('utf8'),metadata:{totalBytes,retainedBytes,truncated:totalBytes>retainedBytes,sha256:hash.digest('hex')}};}
 };
}
